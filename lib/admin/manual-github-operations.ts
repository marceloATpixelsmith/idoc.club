import 'server-only';

export const MANUAL_GITHUB_WORKFLOWS = {
  'production-promotion': {
    file: 'monitored-production-promotion.yml',
    label: 'Promote Staging to Production',
    url: 'https://github.com/marceloATpixelsmith/idoc.club/actions/workflows/monitored-production-promotion.yml',
  },
  'production-recovery': {
    file: 'auto-migrate-production.yml',
    label: 'Recover merged Production release',
    url: 'https://github.com/marceloATpixelsmith/idoc.club/actions/workflows/auto-migrate-production.yml',
  },
  'live-auth': {
    file: 'live-auth-staging.yml',
    label: 'Live authentication staging suite',
    url: 'https://github.com/marceloATpixelsmith/idoc.club/actions/workflows/live-auth-staging.yml',
  },
} as const;

export type ManualGithubWorkflow = keyof typeof MANUAL_GITHUB_WORKFLOWS;
export type ManualGithubRun = {
  id: number;
  workflow: ManualGithubWorkflow;
  runNumber: number;
  status: 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled' | 'other';
  event: string;
  startedAt: string;
  runUrl: string;
  steps?: Array<{ name: string; status: string; conclusion: string | null }>;
};

export class ManualGithubOperationsError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ManualGithubOperationsError';
    this.status = status;
  }
}

export function isManualGithubWorkflow(value: unknown): value is ManualGithubWorkflow {
  return typeof value === 'string' && Object.hasOwn(MANUAL_GITHUB_WORKFLOWS, value);
}

function token() {
  const value = process.env.GITHUB_BACKUP_TOOL_TOKEN?.trim();
  if (!value) throw new ManualGithubOperationsError('GitHub Actions are not configured for this deployment. Check the existing GITHUB_BACKUP_TOOL_TOKEN setting.');
  return value;
}

async function github(path: string, init: RequestInit = {}): Promise<Response> {
  const authorization = `Bearer ${token()}`;
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/marceloATpixelsmith/idoc.club${path}`, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: authorization,
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
    });
  } catch {
    throw new ManualGithubOperationsError('GitHub could not be reached. Try again shortly.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new ManualGithubOperationsError('GitHub rejected the existing Actions token. Check its repository scope, Actions read/write and Pull requests read/write permissions, and expiry.', response.status);
  }
  if (response.status === 404) {
    throw new ManualGithubOperationsError('GitHub cannot find this workflow on the default branch yet. Promote the workflow file to main, then try again.', response.status);
  }
  if (!response.ok && response.status !== 204) {
    if (response.status === 422) {
      throw new ManualGithubOperationsError('GitHub could not perform this operation. GitHub rejected this request. Check that the workflow is enabled on main, the GitHub token has Actions write permission, and the workflow inputs are valid.', response.status);
    }
    throw new ManualGithubOperationsError(`GitHub returned an unexpected status (${response.status}).`, response.status);
  }
  return response;
}

function runStatus(status: string, conclusion: string | null): ManualGithubRun['status'] {
  if (status === 'queued' || status === 'requested' || status === 'waiting' || status === 'pending') return 'queued';
  if (status !== 'completed') return 'in_progress';
  if (conclusion === 'success') return 'success';
  if (conclusion === 'cancelled') return 'cancelled';
  if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'action_required') return 'failure';
  return 'other';
}

async function loadPromotionSteps(runId: number): Promise<NonNullable<ManualGithubRun['steps']>> {
  const response = await github(`/actions/runs/${runId}/jobs?per_page=10`);
  const body = await response.json() as { jobs?: Array<{ steps?: Array<{ name: string; status: string; conclusion: string | null }> }> };
  return (body.jobs ?? []).flatMap((job) => job.steps ?? []).filter((step) =>
    /Check PR, reviews|Merge verified promotion|Verify Vercel production|Verify production health/i.test(step.name));
}

export async function listManualGithubOperationRuns(): Promise<ManualGithubRun[]> {
  const entries = await Promise.all(Object.entries(MANUAL_GITHUB_WORKFLOWS).map(async ([workflow, config]) => {
    try {
      const response = await github(`/actions/workflows/${config.file}/runs?branch=${workflow === 'live-auth' ? 'staging' : 'main'}&per_page=5`);
      const body = await response.json() as { workflow_runs?: Array<{ id: number; run_number: number; status: string; conclusion: string | null; event: string; created_at: string; html_url: string }> };
      return Promise.all((body.workflow_runs ?? []).map(async (run) => ({
        id: run.id,
        workflow: workflow as ManualGithubWorkflow,
        runNumber: run.run_number,
        status: runStatus(run.status, run.conclusion),
        event: run.event,
        startedAt: run.created_at,
        runUrl: run.html_url,
        ...(workflow === 'production-promotion' || workflow === 'production-recovery' ? { steps: await loadPromotionSteps(run.id) } : {}),
      })));
    } catch (error) {
      // A workflow is not dispatchable until its definition reaches the default branch.
      if (error instanceof ManualGithubOperationsError && error.status === 404) return [];
      throw error;
    }
  }));
  return entries.flat().sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
}

export async function dispatchManualGithubOperation(workflow: ManualGithubWorkflow): Promise<string | undefined> {
  if (!isManualGithubWorkflow(workflow)) throw new ManualGithubOperationsError('Choose one of the available GitHub operations.');
  if (workflow === 'production-promotion') {
    // OPEN THE EXISTING PROTECTED STAGING-TO-MAIN PR PATH, NEVER PUSH DIRECTLY TO MAIN.
    const existing = await github('/pulls?state=open&base=main&per_page=100');
    const payload = await existing.json() as Array<{ head?: { ref?: string; repo?: { full_name?: string } }; html_url?: string }>;
    const pending = payload.find((pr) => pr.head?.ref === 'staging' && pr.head.repo?.full_name === 'marceloATpixelsmith/idoc.club');
    let url = pending?.html_url;
    if (!url) {
      // A merge may have already landed on main while the protected backup/migration/deploy
      // sequence never ran. Never attempt an empty staging -> main PR: recover via the
      // separately approved, backup-first production maintenance workflow instead.
      const comparison = await github('/compare/main...staging');
      const branches = await comparison.json() as { ahead_by?: number };
      if (branches.ahead_by === 0) {
        await github('/actions/workflows/auto-migrate-production.yml/dispatches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: 'main' }),
        });
        return MANUAL_GITHUB_WORKFLOWS['production-recovery'].url;
      }
    }
    if (!url) {
      const response = await github('/pulls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Promote staging to production (main)',
          head: 'staging',
          base: 'main',
          body: 'Super Admin authorized staging promotion. The monitored workflow will verify required CI/reviews, merge using branch protections, verify Vercel and check production health. Staging acceptance requirements in docs/07 must be completed before initiation.',
          draft: false,
        }),
      });
      const created = await response.json() as { html_url?: string };
      url = created.html_url;
    }
    if (!url || !/^https:\/\/github\.com\/marceloATpixelsmith\/idoc\.club\/pull\/\d+$/.test(url)) {
      throw new ManualGithubOperationsError('GitHub did not return a valid production promotion pull request URL.');
    }
    const number = Number(url.split('/').pop());
    const detailsResponse = await github(`/pulls/${number}`);
    const details = await detailsResponse.json() as { head?: { sha?: string; ref?: string }; base?: { ref?: string }; state?: string };
    if (details.state !== 'open' || details.head?.ref !== 'staging' || details.base?.ref !== 'main' ||
      !/^[a-f0-9]{40}$/i.test(details.head?.sha ?? '')) {
      throw new ManualGithubOperationsError('Promotion PR is not an open staging-to-main request with a valid commit.');
    }
    await github('/actions/workflows/monitored-production-promotion.yml/dispatches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: 'main',
        inputs: { pr_number: String(number), expected_head_sha: details.head.sha },
      }),
    });
    return url;
  }
  const config = MANUAL_GITHUB_WORKFLOWS[workflow];
  await github(`/actions/workflows/${config.file}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'staging' }),
  });
}
