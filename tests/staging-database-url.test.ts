import assert from 'node:assert/strict';
import test from 'node:test';
import { requireDisposableTestEmail, validateStagingDatabaseUrl } from '../lib/db/staging-database-url.ts';

const STAGING = 'postgres://idoc_staging_app:secret@staging-db.render.com/ayni_space?options=-c%20search_path%3Didoc_staging';

test('requires explicit staging confirmation before touching anything', () => {
  assert.throws(() => validateStagingDatabaseUrl(STAGING, false));
  const url = validateStagingDatabaseUrl(STAGING, true);
  assert.equal(url.username, 'idoc_staging_app');
  assert.equal(url.pathname, '/ayni_space');
});

test('rejects missing or malformed URLs and production schema credentials', () => {
  for (const value of [undefined, '', 'not-a-url', 'mysql://u:p@localhost/ayni_space', 'postgres://localhost/ayni_space', 'postgres://idoc_production_app:secret@db.render.com/ayni_space?options=-c%20search_path%3Didoc_production', 'postgres://idoc_staging_app:secret@db.render.com/ayni_space?options=-c%20search_path%3Didoc_production', 'postgres://idoc_staging_app:secret@db.render.com/other?options=-c%20search_path%3Didoc_staging']) {
    assert.throws(() => validateStagingDatabaseUrl(value, true));
  }
});


test('adds the staging search path to a verified staging URL when absent', () => {
  const url = validateStagingDatabaseUrl('postgres://idoc_staging_app:secret@staging-db.render.com/ayni_space?sslmode=require', true);
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('options'), '-c search_path=idoc_staging');
});

test('only accepts disposable @pixelsmith.space test addresses', () => {
  assert.equal(requireDisposableTestEmail('live-auth-001@pixelsmith.space'), 'live-auth-001@pixelsmith.space');
  assert.equal(requireDisposableTestEmail(' Live-Auth-002@Pixelsmith.Space '), 'Live-Auth-002@Pixelsmith.Space');
  for (const value of [undefined, '', 'member@idoc.club', 'admin@pixelsmith.space.evil.com', 'not-an-email']) {
    assert.throws(() => requireDisposableTestEmail(value));
  }
});
