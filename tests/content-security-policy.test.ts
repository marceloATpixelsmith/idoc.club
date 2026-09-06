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
