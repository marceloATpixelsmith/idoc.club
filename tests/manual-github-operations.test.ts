import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  dispatchManualGithubOperation,
  isManualGithubWorkflow,
  listManualGithubOperationRuns,
} from '../lib/admin/manual-github-operations.ts';

test('the approved promotion opens a protected staging-to-main PR, while live auth stays on staging', async () => {
  const oldToken = process.env.GITHUB_BACKUP_TOOL_TOKEN;
  const oldFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
  process.env.GITHUB_BACKUP_TOOL_TOKEN = 'test-github-token';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.includes('/pulls?')) return new Response('[]', { status: 200 });
    if (url.endsWith('/pulls')) return new Response(JSON.stringify({ html_url: 'https://github.com/marceloATpixelsmith/idoc.club/pull/999' }), { status: 201 });
    if (url.endsWith('/pulls/999')) return new Response(JSON.stringify({ state: 'open', head: { ref: 'staging', sha: 'a'.repeat(40) }, base: { ref: 'main' } }), { status: 200 });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    assert.equal(isManualGithubWorkflow('staging-migrations'), false);
    assert.equal(isManualGithubWorkflow('production-promotion'), true);
    assert.equal(isManualGithubWorkflow('live-auth'), true);
    assert.equal(isManualGithubWorkflow('manual-promotion-0071'), false);
    const result = await dispatchManualGithubOperation('production-promotion');
    await dispatchManualGithubOperation('live-auth');
    assert.equal(result, 'https://github.com/marceloATpixelsmith/idoc.club/pull/999');
    assert.equal(requests.length, 5);
    assert.equal(requests[0].url, 'https://api.github.com/repos/marceloATpixelsmith/idoc.club/pulls?state=open&base=main&per_page=100');
    assert.equal(requests[1].method, 'POST');
    assert.equal(requests[1].url, 'https://api.github.com/repos/marceloATpixelsmith/idoc.club/pulls');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}').head, 'staging');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}').base, 'main');
    assert.equal(requests[3].url, 'https://api.github.com/repos/marceloATpixelsmith/idoc.club/actions/workflows/monitored-production-promotion.yml/dispatches');
    assert.deepEqual(JSON.parse(requests[3].body ?? '{}'), { ref: 'main', inputs: { pr_number: '999', expected_head_sha: 'a'.repeat(40) } });
    assert.equal(requests[4].url, 'https://api.github.com/repos/marceloATpixelsmith/idoc.club/actions/workflows/live-auth-staging.yml/dispatches');
    assert.deepEqual(JSON.parse(requests[4].body ?? '{}'), { ref: 'staging' });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.GITHUB_BACKUP_TOOL_TOKEN;
    else process.env.GITHUB_BACKUP_TOOL_TOKEN = oldToken;
  }
});

test('an existing staging-to-main promotion PR is reused', async () => {
  const oldToken = process.env.GITHUB_BACKUP_TOOL_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.GITHUB_BACKUP_TOOL_TOKEN = 'test-github-token';
  let requestCount = 0;
  globalThis.fetch = (async (input) => {
    requestCount += 1;
    const url = String(input);
    if (url.endsWith('/pulls/998')) return new Response(JSON.stringify({ state: 'open', head: { ref: 'staging', sha: 'b'.repeat(40) }, base: { ref: 'main' } }), { status: 200 });
    if (url.endsWith('/dispatches')) return new Response(null, { status: 204 });
    return new Response(JSON.stringify([{ head: { ref: 'staging', repo: { full_name: 'marceloATpixelsmith/idoc.club' } }, html_url: 'https://github.com/marceloATpixelsmith/idoc.club/pull/998' }]), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await dispatchManualGithubOperation('production-promotion');
    assert.equal(result, 'https://github.com/marceloATpixelsmith/idoc.club/pull/998');
    assert.equal(requestCount, 3);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.GITHUB_BACKUP_TOOL_TOKEN;
    else process.env.GITHUB_BACKUP_TOOL_TOKEN = oldToken;
  }
});

test('recent runs expose only safe status and run-link fields', async () => {
  const oldToken = process.env.GITHUB_BACKUP_TOOL_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.GITHUB_BACKUP_TOOL_TOKEN = 'test-github-token';
  globalThis.fetch = (async (input) => new Response(JSON.stringify(String(input).includes('/jobs?') ? { jobs: [{ steps: [{ name: 'Verify production health', status: 'completed', conclusion: 'success' }] }] } : {
    workflow_runs: [{
      id: 42,
      run_number: 7,
      status: 'completed',
      conclusion: 'failure',
      event: 'workflow_dispatch',
      created_at: '2026-10-21T12:00:00Z',
      html_url: 'https://github.com/marceloATpixelsmith/idoc.club/actions/runs/42',
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

  try {
    const runs = await listManualGithubOperationRuns();
    assert.equal(runs.length, 2);
    assert.equal(runs.find((run) => run.workflow === 'production-promotion')?.steps?.[0]?.conclusion, 'success');
    assert.equal(runs[0].status, 'failure');
    assert.equal(runs[0].event, 'workflow_dispatch');
    assert.equal(runs[0].runUrl, 'https://github.com/marceloATpixelsmith/idoc.club/actions/runs/42');
    assert.equal('token' in runs[0], false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.GITHUB_BACKUP_TOOL_TOKEN;
    else process.env.GITHUB_BACKUP_TOOL_TOKEN = oldToken;
  }
});

test('dedicated Super Admin pages share protected launch actions and show live-auth report drawers', () => {
  const actions = readFileSync('app/(dashboard)/admin/operations/github-operations/actions.ts', 'utf8');
  const navigation = readFileSync('components/admin-navigation.tsx', 'utf8');
  const livePage = readFileSync('app/(dashboard)/admin/operations/live-auth-tests/page.tsx', 'utf8');
  const promotionPage = readFileSync('app/(dashboard)/admin/operations/production-promotion/page.tsx', 'utf8');
  const history = readFileSync('app/(dashboard)/admin/operations/live-auth-tests/live-auth-run-history.tsx', 'utf8');
  const drawer = readFileSync('app/(dashboard)/admin/operations/live-auth-tests/live-auth-results-drawer.tsx', 'utf8');
  const api = readFileSync('lib/admin/live-auth-reports.ts', 'utf8');
  const workflow = readFileSync('.github/workflows/live-auth-staging.yml', 'utf8');
  assert.match(actions, /requireSuperAdmin\(actor\)/);
  assert.match(actions, /requireCsrfToken\(formData/);
  assert.match(actions, /requireFreshStepUp\(actor, 'change-security-settings'/);
  assert.match(actions, /admin\.github_operation\.requested/);
  assert.match(actions, /listManualGithubOperationRuns\(\)[\s\S]*reserveRequest[\s\S]*dispatchManualGithubOperation/);
  assert.match(navigation, /Backups & restore'[\s\S]*Promote To Production[\s\S]*Live Authentication Tests/);
  assert.match(livePage, /ManualGithubOperationForm[\s\S]*LiveAuthRunHistory/);
  assert.match(promotionPage, /PromotionStatusRefresh/);
  assert.match(history, /LiveAuthResultsDrawer/);
  assert.match(drawer, /PARTIALLY EXERCISED/);
  assert.match(drawer, /Not Tested \/ Not Applicable/);
  assert.match(history, /AUTH NOT FULLY VERIFIED/);
  assert.match(api, /requireSuperAdmin/);
  assert.match(api, /auth-live-results\.json/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /\non:\n  workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /\n  (push|pull_request|pull_request_target|schedule|workflow_run):/);
});

test('promotion workflow reports CI, reviews, merge, Vercel and production health separately', () => {
  const workflow = readFileSync('.github/workflows/monitored-production-promotion.yml', 'utf8');
  const script = readFileSync('scripts/monitored-production-promotion.mjs', 'utf8');
  const page = readFileSync('app/(dashboard)/admin/operations/production-promotion/page.tsx', 'utf8');
  assert.match(workflow, /environment: idoc-db-production-maintenance/);
  assert.match(workflow, /monitored-production-promotion\.mjs trigger/);
  assert.match(workflow, /guard-pending-migrations\.mjs after/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /monitored-production-promotion\.mjs verify/);
  assert.match(workflow, /monitored-production-promotion\.mjs merge/);
  assert.match(workflow, /monitored-production-promotion\.mjs deploy/);
  assert.match(workflow, /monitored-production-promotion\.mjs health/);
  assert.match(script, /reviewThreads\(first:100\)/);
  assert.match(script, /hold-merge/);
  assert.match(script, /Fast PR verification/);
  assert.match(script, /merge_method: 'merge'/);
  assert.match(script, /\/commits\/\$\{sha\}\/statuses/);
  assert.match(script, /PRODUCTION_HEALTH_URL/);
  assert.match(page, /PromotionStatusRefresh/);
});

test('production promotion blocks missing risk-classified workflows and comment holds', () => {
  const script = readFileSync('scripts/monitored-production-promotion.mjs', 'utf8');
  assert.match(script, /\/issues\/\$\{prNumber\}\/comments\?per_page=100/);
  assert.match(script, /hold-merge\|do not merge\|hold promotion/);
  assert.match(script, /clear-hold-merge/);
  assert.match(script, /\^\\s\*clear-hold-merge\\s\*\$\/i/);
  assert.doesNotMatch(script, /\(\?:\^\|\\s\)clear-hold-merge/);
  //VERIFY WHITESPACE TOKENS ARE ACTUAL REGEX ESCAPES, NOT LITERAL BACKSLASH-S.
  assert.match(script, /\(\?:\^\|\\s\)\(\?:hold-merge/);
  assert.doesNotMatch(script, /\(\?:\^\|\\\\s\)\(\?:hold-merge/);
  assert.match(script, /repositoryOwner/);
  assert.match(script, /head_sha=\$\{expectedHead\}&per_page=100/);
  assert.doesNotMatch(script, /event=pull_request&per_page/);
  assert.match(script, /if \(!latest\)/);
  assert.match(script, /latest\.conclusion !== 'success'/);
  assert.match(script, /'Release 1 Verification'/);
  assert.match(script, /'Authentication security verification'/);
});
