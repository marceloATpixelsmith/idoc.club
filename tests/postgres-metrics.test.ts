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

test('statement gauges are cumulative per idoc_ role, use no statement text, and are optional', async () => {
  const source = await import('node:fs/promises');
  const contents = await source.readFile('lib/observability/postgres-metrics.ts', 'utf8');
  assert.match(contents, /FROM public\.pg_stat_statements/);
  assert.match(contents, /starts_with\(r\.rolname, 'idoc_'\)/);
  assert.match(contents, /dbid = \(SELECT oid FROM pg_database WHERE datname = current_database\(\)\)/);
  // The statement text column must never be selected from pg_stat_statements.
  assert.doesNotMatch(contents, /SELECT[^;`]*\bquery\b[^;`]*FROM public\.pg_stat_statements/i);
  assert.match(contents, /catch \{\s*return undefined;/);
  assert.match(contents, /postgres\.statements\.calls/);
  assert.match(contents, /postgres\.statements\.exec_time/);
  // Lifetime per-statement averages were removed because they never recover after one slow run.
  assert.doesNotMatch(contents, /mean_exec_time|slowest_mean/);
});
