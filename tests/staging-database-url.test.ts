import assert from 'node:assert/strict';
import test from 'node:test';
import { requireDisposableTestEmail, validateStagingDatabaseUrl } from '../lib/db/staging-database-url.ts';

const STAGING = 'postgres://idoc_staging_app:secret@staging-db.render.com/ayni_space';

test('requires explicit staging confirmation before touching anything', () => {
  assert.throws(() => validateStagingDatabaseUrl(STAGING, false));
  assert.equal(validateStagingDatabaseUrl(STAGING, true).username, 'idoc_staging_app');
  assert.equal(validateStagingDatabaseUrl(STAGING, true).pathname, '/ayni_space');
});

test('rejects missing, malformed, production-role, or wrong-database URLs even when confirmed', () => {
  for (const value of [
    undefined,
    '',
    'not-a-url',
    'mysql://idoc_staging_app:p@localhost/ayni_space',
    'postgres://localhost/ayni_space',
    'postgres://tester:secret@staging-db.render.com/ayni_space',
    'postgres://idoc_production_app:secret@staging-db.render.com/ayni_space',
    'postgres://idoc_staging_app:secret@staging-db.render.com/idoc_production',
  ]) {
    assert.throws(() => validateStagingDatabaseUrl(value, true));
  }
});

test('accepts only the staging application role and IDOC database', () => {
  const url = validateStagingDatabaseUrl(STAGING, true);
  assert.equal(url.hostname, 'staging-db.render.com');
  assert.equal(url.username, 'idoc_staging_app');
  assert.equal(url.pathname, '/ayni_space');
});

test('only accepts disposable @pixelsmith.space test addresses', () => {
  assert.equal(requireDisposableTestEmail('live-auth-001@pixelsmith.space'), 'live-auth-001@pixelsmith.space');
  assert.equal(requireDisposableTestEmail(' Live-Auth-002@Pixelsmith.Space '), 'Live-Auth-002@Pixelsmith.Space');
  for (const value of [undefined, '', 'member@idoc.club', 'admin@pixelsmith.space.evil.com', 'not-an-email']) {
    assert.throws(() => requireDisposableTestEmail(value));
  }
});
