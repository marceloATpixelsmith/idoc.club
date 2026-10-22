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
    assert.equal(requests.length, 3);
    assert.equal(requests[0].url, 'https://api.github.com/repos/marceloATpixelsmith/idoc.club/pulls?state=open&base=main&per_page=100');
    assert.equal(requests[1].method, 'POST');
    assert.equal(requests[1].url, 'https://api.github.com/repos/marceloATpixelsmith/idoc.club/pulls');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}').head, 'staging');
    assert.deepEqual(JSON.parse(requests[1].body ?? '{}').base, 'main');
    assert.equal(requests[2].url, 'https://api.github.com/repos/marceloATpixelsmith/idoc.club/actions/workflows/live-auth-staging.yml/dispatches');
    assert.deepEqual(JSON.parse(requests[2].body ?? '{}'), { ref: 'staging' });
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
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response(JSON.stringify([{ head: { ref: 'staging', repo: { full_name: 'marceloATpixelsmith/idoc.club' } }, html_url: 'https://github.com/marceloATpixelsmith/idoc.club/pull/998' }]), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await dispatchManualGithubOperation('production-promotion');
    assert.equal(result, 'https://github.com/marceloATpixelsmith/idoc.club/pull/998');
    assert.equal(requestCount, 1);
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
  globalThis.fetch = (async () => new Response(JSON.stringify({
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
    assert.equal(runs.length, 1);
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

test('the Super Admin page authorizes, verifies, audits and protects manual dispatches', () => {
  const page = readFileSync('app/(dashboard)/admin/operations/github-operations/page.tsx', 'utf8');
  const navigation = readFileSync('components/admin-navigation.tsx', 'utf8');
  const workflow = readFileSync('.github/workflows/live-auth-staging.yml', 'utf8');
  assert.match(page, /requireSuperAdmin\(actor\)/);
  assert.match(page, /requireCsrfToken\(formData/);
  assert.match(page, /requireFreshStepUp\(actor, 'change-security-settings'/);
  assert.match(page, /admin\.github_operation\.requested/);
  assert.match(page, /listManualGithubOperationRuns\(\)[\s\S]*reserveRequest[\s\S]*dispatchManualGithubOperation/);
  assert.match(navigation, /Backups & restore'[\s\S]*Manual GitHub Operations/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(page, /Promote Staging to Production/);
  assert.doesNotMatch(page, /Apply Staging Migrations/);
});
