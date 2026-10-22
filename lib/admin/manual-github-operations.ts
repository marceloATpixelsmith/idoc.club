import 'server-only';

export const MANUAL_GITHUB_WORKFLOWS = {
  'staging-migrations': {
    file: 'auto-migrate-staging.yml',
    label: 'Auto-migrate Staging Schema',
    url: 'https://github.com/marceloATpixelsmith/idoc.club/actions/workflows/auto-migrate-staging.yml',
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
    throw new ManualGithubOperationsError('GitHub rejected the existing Actions token. Check its repository scope, Actions read/write permission and expiry.', response.status);
  }
  if (response.status === 404) {
    throw new ManualGithubOperationsError('GitHub cannot find this workflow on the default branch yet. Promote the workflow file to main, then try again.', response.status);
  }
  if (!response.ok && response.status !== 204) {
    if (response.status === 422) {
      throw new ManualGithubOperationsError('GitHub could not dispatch this workflow. Confirm workflow_dispatch is enabled and the workflow exists on main.', response.status);
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

export async function listManualGithubOperationRuns(): Promise<ManualGithubRun[]> {
  const entries = await Promise.all(Object.entries(MANUAL_GITHUB_WORKFLOWS).map(async ([workflow, config]) => {
    try {
      const response = await github(`/actions/workflows/${config.file}/runs?branch=staging&per_page=5`);
      const body = await response.json() as { workflow_runs?: Array<{ id: number; run_number: number; status: string; conclusion: string | null; event: string; created_at: string; html_url: string }> };
      return (body.workflow_runs ?? []).map((run) => ({
        id: run.id,
        workflow: workflow as ManualGithubWorkflow,
        runNumber: run.run_number,
        status: runStatus(run.status, run.conclusion),
        event: run.event,
        startedAt: run.created_at,
        runUrl: run.html_url,
      }));
    } catch (error) {
      // The live-auth workflow is not dispatchable through GitHub until its file reaches the default branch.
      // Keep the page usable for the staging-migration action during that promotion window.
      if (error instanceof ManualGithubOperationsError && error.status === 404) return [];
      throw error;
    }
  }));
  return entries.flat().sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
}

export async function dispatchManualGithubOperation(workflow: ManualGithubWorkflow): Promise<void> {
  if (!isManualGithubWorkflow(workflow)) throw new ManualGithubOperationsError('Choose one of the available GitHub operations.');
  const config = MANUAL_GITHUB_WORKFLOWS[workflow];
  await github(`/actions/workflows/${config.file}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'staging' }),
  });
}
