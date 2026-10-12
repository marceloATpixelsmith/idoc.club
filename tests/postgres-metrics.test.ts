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

test('Render CPU and memory gauges use fixed GET requests, keep the key out of output, and are optional', async () => {
  const source = await import('node:fs/promises');
  const contents = await source.readFile('lib/observability/postgres-metrics.ts', 'utf8');
  assert.match(contents, /https:\/\/api\.render\.com\/v1\/metrics\//);
  assert.match(contents, /dpg-d3c3gd2li9vc73d8n3o0-a/);
  assert.match(contents, /authorization: `Bearer \$\{key\}`/);
  assert.match(contents, /AbortSignal\.timeout\(5000\)/);
  assert.match(contents, /if \(!key\) return undefined;/);
  // The key is read in exactly one place and never logged or placed in any returned payload.
  assert.equal((contents.match(/RENDER_API_KEY/g) ?? []).length, 2); // the read and the comment
  assert.doesNotMatch(contents, /console\.(log|info|warn|error)/);
  assert.match(contents, /toISOString\(\)\.replace/); // RFC 3339 times, as Render's specification requires
  assert.match(contents, /postgres\.memory\.usage/);
  assert.match(contents, /postgres\.cpu\.limit/);
  // Only GET requests; no method override anywhere in this file.
  assert.doesNotMatch(contents, /method:\s*['"](POST|PUT|PATCH|DELETE)/);
});
