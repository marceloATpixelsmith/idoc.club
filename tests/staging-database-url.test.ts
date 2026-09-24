import assert from 'node:assert/strict';
import test from 'node:test';
import { requireDisposableTestEmail, validateStagingDatabaseUrl } from '../lib/db/staging-database-url.ts';

const STAGING = 'postgres://tester:secret@staging-db.render.com/idoc_staging';

test('requires explicit staging confirmation before touching anything', () => {
  assert.throws(() => validateStagingDatabaseUrl(STAGING, false));
  assert.equal(validateStagingDatabaseUrl(STAGING, true).pathname, '/idoc_staging');
});

test('rejects missing or malformed URLs even when confirmed', () => {
  for (const value of [undefined, '', 'not-a-url', 'mysql://u:p@localhost/idoc_staging', 'postgres://localhost/idoc_staging']) {
    assert.throws(() => validateStagingDatabaseUrl(value, true));
  }
});

test('accepts a staging URL that is identical to production -- staging deliberately shares the production database', () => {
  assert.equal(validateStagingDatabaseUrl(STAGING, true).hostname, 'staging-db.render.com');
});

test('only accepts disposable @pixelsmith.space test addresses', () => {
  assert.equal(requireDisposableTestEmail('live-auth-001@pixelsmith.space'), 'live-auth-001@pixelsmith.space');
  assert.equal(requireDisposableTestEmail(' Live-Auth-002@Pixelsmith.Space '), 'Live-Auth-002@Pixelsmith.Space');
  for (const value of [undefined, '', 'member@idoc.club', 'admin@pixelsmith.space.evil.com', 'not-an-email']) {
    assert.throws(() => requireDisposableTestEmail(value));
  }
});
