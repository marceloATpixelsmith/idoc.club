import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('weekly New Relic health check is scheduled Monday 08:00 UTC and reachable only through the signed QStash route', () => {
  assert.match(read('lib/background/qstash.ts'), /'new-relic-weekly-health-check': '0 8 \* \* 1'/);
  assert.match(read('scripts/configure-qstash-schedules.mjs'), /'new-relic-weekly-health-check': '0 8 \* \* 1'/);
  assert.match(read('app/api/qstash/jobs/route.ts'), /'new-relic-weekly-health-check': newRelicHealthCheck/);
  assert.doesNotMatch(read('vercel.json'), /new-relic-health-check/);
});

test('health check route uses the shared cron secret and the check keeps credentials out of output', () => {
  assert.match(read('app/api/cron/new-relic-health-check/route.ts'), /secret: cronSecretForServer\(\)/);
  const source = read('lib/observability/new-relic-health-check.ts');
  assert.match(source, /NEW_RELIC_QUERY_KEY/);
  assert.doesNotMatch(source, /NEW_RELIC_API_KEY|OTEL_EXPORTER_OTLP/);
  assert.match(source, /escapeHtml\(row\.route\)/);
});

test('result mapping drops empty rows and sorts slow routes by p95', async () => {
  const { toErrorRows, toSlowRows } = await import('../lib/observability/new-relic-health-rows.ts');
  assert.deepEqual(toErrorRows([{ 'http.route': '/a', errors: 3 }, { 'http.route': '/b', errors: 0 }]), [{ route: '/a', value: 3 }]);
  assert.deepEqual(
    toSlowRows([{ 'http.route': '/fast', p95: { '95': 10 }, requests: 5 }, { 'http.route': '/slow', p95: { '95': 900 }, requests: 2 }]).map((row) => row.route),
    ['/slow', '/fast'],
  );
});

test('queries are scoped to the invoking deployment environment', async () => {
  const source = read('lib/observability/new-relic-health-check.ts');
  assert.match(source, /deployment\.environment\.name = '\$\{environment\}'/);
  assert.match(source, /healthQueries\(environment\)/);
});
