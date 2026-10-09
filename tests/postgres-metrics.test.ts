import assert from 'node:assert/strict';
import test from 'node:test';

// Payload serialization is tested separately from connecting to PostgreSQL.
test('PostgreSQL metrics payload does not include database or member details', async () => {
  const source = await import('node:fs/promises');
  const contents = await source.readFile('lib/observability/postgres-metrics.ts', 'utf8');
  assert.match(contents, /WHERE d\.datname = current_database\(\)/);
  assert.doesNotMatch(contents, /pg_stat_activity|query_text|email|password/i);
  const route = await source.readFile('app/api/internal/postgres-metrics/route.ts', 'utf8');
  assert.match(route, /VERCEL_GIT_COMMIT_REF !== 'staging'/);
  assert.match(route, /timingSafeEqual/);
  assert.doesNotMatch(route, /console\.log\(metrics\)/);
});
