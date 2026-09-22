import assert from 'node:assert/strict';
import test from 'node:test';
import { requireDisposableTestEmail, validateStagingDatabaseUrl } from '../lib/db/staging-database-url.ts';

const STAGING = 'postgres://tester:secret@staging-db.render.com/idoc_staging';

test('requires explicit staging confirmation before touching anything', () => {
  assert.throws(() => validateStagingDatabaseUrl(STAGING, undefined, false));
  assert.equal(validateStagingDatabaseUrl(STAGING, undefined, true).pathname, '/idoc_staging');
});

test('rejects missing or malformed URLs even when confirmed', () => {
  for (const value of [undefined, '', 'not-a-url', 'mysql://u:p@localhost/idoc_staging', 'postgres://localhost/idoc_staging']) {
    assert.throws(() => validateStagingDatabaseUrl(value, undefined, true));
  }
});

test('refuses to run when the staging URL matches the known production URL', () => {
  assert.throws(() => validateStagingDatabaseUrl(STAGING, STAGING, true));
  assert.throws(() => validateStagingDatabaseUrl(
    'postgresql://other:other@STAGING-DB.render.com:5432/idoc_staging?sslmode=require',
    STAGING,
    true,
  ));
});

test('accepts a staging URL that genuinely differs from production', () => {
  const production = 'postgres://tester:secret@production-db.render.com/idoc_production';
  assert.equal(validateStagingDatabaseUrl(STAGING, production, true).hostname, 'staging-db.render.com');
});

test('fails closed when the production URL cannot be compared safely', () => {
  assert.throws(() => validateStagingDatabaseUrl(STAGING, 'not-a-url', true));
});

test('only accepts disposable @pixelsmith.space test addresses', () => {
  assert.equal(requireDisposableTestEmail('live-auth-001@pixelsmith.space'), 'live-auth-001@pixelsmith.space');
  assert.equal(requireDisposableTestEmail(' Live-Auth-002@Pixelsmith.Space '), 'Live-Auth-002@Pixelsmith.Space');
  for (const value of [undefined, '', 'member@idoc.club', 'admin@pixelsmith.space.evil.com', 'not-an-email']) {
    assert.throws(() => requireDisposableTestEmail(value));
  }
});
