import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const connection = readFileSync('lib/db/connection-url.ts', 'utf8');
const driver = readFileSync('lib/db/drizzle.ts', 'utf8');
const migrator = readFileSync('scripts/migrate-selected-schema.ts', 'utf8');

test('application pool is opt-in, transaction-compatible, and migration connection stays direct', () => {
  assert.match(connection, /POSTGRES_POOL_ENABLED !== 'true'/);
  assert.match(connection, /pooledUrl\.port = '6432'/);
  assert.match(connection, /export function getApplicationPostgresConnectionUrl/);
  assert.match(driver, /prepare: false/);
  assert.match(driver, /application_name: 'idoc-club'/);
  assert.match(driver, /getApplicationPostgresConnectionUrl\(\)/);
  assert.match(migrator, /getPostgresConnectionUrl\(\)/);
  assert.doesNotMatch(migrator, /getApplicationPostgresConnectionUrl/);
});
