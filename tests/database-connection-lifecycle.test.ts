import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('lib/db/drizzle.ts', 'utf8');

test('shared Postgres.js client caps connections for every application feature', () => {
  assert.match(source, /max:\s*2,/);
  assert.match(source, /idle_timeout:\s*120,/);
  assert.match(source, /max_lifetime:\s*1800,/);
  assert.match(source, /connect_timeout:\s*10,/);
  assert.match(source, /application_name:\s*'idoc-club'/);
  assert.match(source, /postgres\(getApplicationPostgresConnectionUrl\(\), pooled/);
  assert.match(source, /prepare: false/);
  assert.match(source, /: CONNECTION_OPTIONS\)/);
  assert.match(source, /if \(!connection\)/);
});

test('shared Drizzle and raw SQL clients use the same bounded connection pool', () => {
  assert.match(source, /function getDatabase\(\) \{ database \?\?= drizzle\(getClient\(\), \{ schema \}\)/);
  assert.match(source, /Reflect\.apply\(getClient\(\)/);
  assert.match(source, /Reflect\.get\(getDatabase\(\)/);
});
