import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serverDurationMetricPayload, sendServerDurationMetrics } from '../lib/observability/otlp-server-metrics.ts';

function span(attrs: Record<string, unknown>, kind = 1) {
  return {
    kind,
    attributes: attrs,
    duration: [0, 125_000_000] as [number, number],
    endTime: [1_760_000_000, 0] as [number, number],
  };
}
test('exports an OTLP delta histogram for HTTP server spans only', () => {
  const payload = serverDurationMetricPayload([
    span({ 'http.method': 'GET', 'http.route': '/api/user', 'http.status_code': 200 }),
    span({ 'http.method': 'POST', 'http.route': '/member/private@example.com', 'http.status_code': 500 }),
    span({ 'http.method': 'GET' }, 0),
    span({ 'http.method': 'EVIL', 'http.url': 'https://example.org/?token=private' }),
  ]);
  assert.ok(payload);
  const metric = payload.resourceMetrics[0].scopeMetrics[0].metrics[0];
  assert.equal(metric.name, 'http.server.duration');
  assert.equal(metric.histogram.aggregationTemporality, 1);
  assert.equal(metric.histogram.dataPoints.length, 2);
  assert.equal(metric.histogram.dataPoints[0].sum, 125);
  assert.equal(metric.histogram.dataPoints[0].bucketCounts.reduce((a, b) => a + Number(b), 0), 1);
  assert.ok(JSON.stringify(payload).includes('/api/user'));
  assert.ok(!JSON.stringify(payload).includes('private@example.com'));
  assert.ok(!JSON.stringify(payload).includes('token=private'));
});
test('does not export when no supported HTTP server spans are present', async () => {
  assert.equal(serverDurationMetricPayload([span({}, 0)]), null);
  let called = false;
  await sendServerDurationMetrics([span({}, 0)], 'secret', async () => {
    called = true;
    throw new Error('must not call fetch');
  });
  assert.equal(called, false);
});
test('uses fixed New Relic endpoint without leaking the API key', async () => {
  let request: { url: string; init: RequestInit } | undefined;
  await sendServerDurationMetrics([span({ 'http.method': 'GET' })], 'test-secret', async (url, init) => {
    request = { url: String(url), init: init! };
    return new Response('{}', { status: 200 });
  });
  assert.equal(request?.url, 'https://otlp.nr-data.net/v1/metrics');
  assert.equal((request?.init.headers as Record<string, string>)['api-key'], 'test-secret');
  assert.ok(!String(request?.init.body).includes('test-secret'));
});
