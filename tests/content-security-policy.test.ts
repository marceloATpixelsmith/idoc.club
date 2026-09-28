import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSecurityPolicy } from '../lib/security/content-security-policy.ts';

test('production CSP excludes eval while development CSP permits Turbopack updates', () => {
  const production = contentSecurityPolicy('production-nonce', 'production');
  const development = contentSecurityPolicy('development-nonce', 'development');

  assert.doesNotMatch(production.match(/script-src[^;]+/)?.[0] ?? '', /unsafe-eval/);
  assert.match(development.match(/script-src[^;]+/)?.[0] ?? '', /'unsafe-eval'/);
  assert.match(production, /'nonce-production-nonce'/);
  assert.match(development, /'nonce-development-nonce'/);
});

test('CSP permits only the configured HTTPS Sentry ingestion origin', () => {
  const policy = contentSecurityPolicy('nonce', 'production', 'https://public@o123.ingest.sentry.io/456');
  assert.match(policy, /connect-src 'self' https:\/\/challenges\.cloudflare\.com https:\/\/o123\.ingest\.sentry\.io/);
  assert.doesNotMatch(policy, /public@|\/456/);
  assert.doesNotMatch(contentSecurityPolicy('nonce', 'production', 'http://unsafe.example/1'), /unsafe\.example/);
});
