import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Span } from '@opentelemetry/api';
import { jobSpanAttributes, recordJobResult } from '../lib/observability/job-metrics.ts';

test('records the job name, QStash retry count and only plain non-negative integer counts', () => {
  const attributes = jobSpanAttributes('account-delivery', '2', {
    delivered: 3, retryable: 1, deadLettered: 0, error: 'recipient@example.test failed', ids: [1, 2], nested: { a: 1 },
    ratio: 0.5, negative: -1, 'bad key': 4, ok: true,
  });
  assert.deepEqual(attributes, {
    'job.name': 'account-delivery', 'job.retried': 2,
    'job.result.delivered': 3, 'job.result.retryable': 1, 'job.result.deadLettered': 0,
  });
});

test('a missing or invalid retry header and a non-object summary add nothing beyond the job name', () => {
  assert.deepEqual(jobSpanAttributes('clock-skew-check', null, 'text'), { 'job.name': 'clock-skew-check' });
  assert.deepEqual(jobSpanAttributes('clock-skew-check', 'abc', [1, 2]), { 'job.name': 'clock-skew-check' });
  assert.deepEqual(jobSpanAttributes('clock-skew-check', '-1', null), { 'job.name': 'clock-skew-check' });
});

test('recordJobResult sets the attributes from a JSON response without consuming it', async () => {
  const set: Record<string, unknown>[] = [];
  const span = { setAttributes: (a: Record<string, unknown>) => { set.push(a); return span; } } as unknown as Span;
  const response = Response.json({ processed: 7, failed: 0 });
  await recordJobResult('news-scheduled-publish', new Request('https://x.test', { headers: { 'upstash-retried': '1' } }), response, span);
  assert.deepEqual(set[0], { 'job.name': 'news-scheduled-publish', 'job.retried': 1, 'job.result.processed': 7, 'job.result.failed': 0 });
  assert.deepEqual(await response.json(), { processed: 7, failed: 0 });
});

test('telemetry failures never throw, and without an active span nothing happens', async () => {
  const throwing = { setAttributes: () => { throw new Error('boom'); } } as unknown as Span;
  await recordJobResult('x', new Request('https://x.test'), Response.json({ a: 1 }), throwing);
  await recordJobResult('x', new Request('https://x.test'), new Response('plain'), undefined);
});

test('the QStash worker route records the result for every job before post-processing', () => {
  const route = readFileSync('app/api/qstash/jobs/route.ts', 'utf8');
  assert.match(route, /await recordJobResult\(job, request, response\);/);
  assert.ok(route.indexOf('recordJobResult(job') < route.indexOf("if (job === 'account-delivery' && response.ok)"));
});
