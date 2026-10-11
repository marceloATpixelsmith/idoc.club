import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserAgentConfig,
  browserAgentConnectOrigin,
  NEW_RELIC_BEACON_HOST,
  type BrowserAgentEnvironment,
} from '../lib/observability/browser-agent-config.ts';
import { contentSecurityPolicy } from '../lib/security/content-security-policy.ts';

const configured: BrowserAgentEnvironment = {
  NEXT_PUBLIC_NEW_RELIC_BROWSER_ACCOUNT_ID: '8600002',
  NEXT_PUBLIC_NEW_RELIC_BROWSER_AGENT_ID: '1234567890',
  NEXT_PUBLIC_NEW_RELIC_BROWSER_APPLICATION_ID: '1234567890',
  NEXT_PUBLIC_NEW_RELIC_BROWSER_LICENSE_KEY: 'NRJS-0123456789abcdef012',
};
const staging: BrowserAgentEnvironment = {
  ...configured,
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'staging',
};

test('browser agent is disabled unless configured on the staging branch deployment', () => {
  assert.equal(browserAgentConfig({}), null);
  assert.equal(browserAgentConfig(configured), null);
  assert.equal(browserAgentConfig({ ...configured, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }), null);
  assert.equal(browserAgentConfig({ ...configured, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/x' }), null);
  assert.ok(browserAgentConfig(staging));
});

test('browser agent ignores a manually set environment label', () => {
  assert.equal(
    browserAgentConfig({ ...configured, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', NEXT_PUBLIC_VERCEL_ENV: 'preview', NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: 'staging' }),
    null,
  );
});

test('browser agent rejects missing or malformed identifiers', () => {
  for (const key of Object.keys(configured) as (keyof BrowserAgentEnvironment)[]) {
    assert.equal(browserAgentConfig({ ...staging, [key]: undefined }), null, `${key} is required`);
  }
  assert.equal(browserAgentConfig({ ...staging, NEXT_PUBLIC_NEW_RELIC_BROWSER_ACCOUNT_ID: '86 0002' }), null);
  assert.equal(browserAgentConfig({ ...staging, NEXT_PUBLIC_NEW_RELIC_BROWSER_LICENSE_KEY: 'bad key;<script>' }), null);
});

test('browser agent disables replay, session trace, AJAX capture, cookies and user events', () => {
  const config = browserAgentConfig(staging);
  assert.ok(config);
  assert.equal(config.init.session_replay.enabled, false);
  assert.equal(config.init.session_trace.enabled, false);
  assert.equal(config.init.ajax.enabled, false);
  assert.equal(config.init.privacy.cookies_enabled, false);
  assert.equal(config.init.distributed_tracing.enabled, false);
  assert.equal(config.init.generic_events.enabled, false);
  assert.equal(config.init.page_action.enabled, false);
  assert.equal(config.loader_config.trustKey, '8600002');
  assert.equal(config.info.beacon, NEW_RELIC_BEACON_HOST);
});

test('browser agent redacts email-shaped text from reported error messages', () => {
  const rule = browserAgentConfig(staging)?.init.obfuscate[0];
  assert.ok(rule);
  assert.equal('Failed for member@example.org today'.replace(rule.regex, rule.replacement), 'Failed for [redacted-email] today');
});

test('CSP allows the New Relic beacon only when the staging agent is configured, and never adds a script origin', () => {
  const off = contentSecurityPolicy('nonce', 'production', undefined, browserAgentConnectOrigin({}));
  const on = contentSecurityPolicy('nonce', 'production', undefined, browserAgentConnectOrigin(staging));
  assert.doesNotMatch(off, /nr-data\.net/);
  assert.match(on.match(/connect-src[^;]+/)?.[0] ?? '', /https:\/\/bam\.nr-data\.net/);
  assert.doesNotMatch(on.match(/script-src[^;]+/)?.[0] ?? '', /newrelic|nr-data/);
  assert.equal(browserAgentConnectOrigin({ ...staging, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }), '');
});
