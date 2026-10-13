import assert from 'node:assert/strict';
import test from 'node:test';
import { SpanStatusCode, type Tracer } from '@opentelemetry/api';
import { tracedFetch } from '../lib/observability/outbound-fetch.ts';

function fakeTracer() {
  const record = { name: '', attributes: {} as Record<string, unknown>, status: undefined as number | undefined, ended: 0 };
  const span = {
    setAttribute: (key: string, value: unknown) => { record.attributes[key] = value; return span; },
    setStatus: (status: { code: number }) => { record.status = status.code; return span; },
    end: () => { record.ended += 1; },
  };
  const tracer = {
    startActiveSpan: (name: string, options: { attributes?: Record<string, unknown> }, fn: (s: typeof span) => unknown) => {
      record.name = name;
      Object.assign(record.attributes, options.attributes);
      return fn(span);
    },
  } as unknown as Tracer;
  return { tracer, record };
}

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>) {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

test('a successful call records the vendor, fixed domain and HTTP status only', async () => {
  const { tracer, record } = fakeTracer();
  const response = await withFetch(async () => new Response('{}', { status: 201 }), () =>
    tracedFetch('brevo', 'https://api.brevo.com/v3/smtp/email?secret=1', { method: 'POST', body: 'to=user@example.test' }, tracer));
  assert.equal(response.status, 201);
  assert.deepEqual(record.attributes, {
    'idoc.integration': 'brevo', 'url.domain': 'api.brevo.com', 'http.request.method': 'POST', 'http.status_code': 201,
  });
  assert.equal(record.name, 'POST api.brevo.com');
  assert.equal(record.status, undefined);
  assert.equal(record.ended, 1);
});

test('an HTTP error status marks the span as an error and the caller still sees the response', async () => {
  const { tracer, record } = fakeTracer();
  const response = await withFetch(async () => new Response('{}', { status: 401 }), () =>
    tracedFetch('cloudinary', 'https://api.cloudinary.com/v1_1/account/image/upload', { method: 'POST' }, tracer));
  assert.equal(response.status, 401);
  assert.equal(record.status, SpanStatusCode.ERROR);
  assert.equal(record.attributes['http.status_code'], 401);
  assert.equal(record.ended, 1);
});

test('a network failure is rethrown unchanged, marks the span as an error and records no error text', async () => {
  const { tracer, record } = fakeTracer();
  const failure = new Error('connect ECONNREFUSED api.brevo.com');
  await assert.rejects(
    withFetch(async () => { throw failure; }, () => tracedFetch('brevo', 'https://api.brevo.com/v3/smtp/email', { method: 'POST' }, tracer)),
    (error) => error === failure,
  );
  assert.equal(record.status, SpanStatusCode.ERROR);
  assert.ok(!('http.status_code' in record.attributes));
  assert.equal(JSON.stringify(record).includes('ECONNREFUSED'), false);
  assert.equal(record.ended, 1);
});

test('the two vendor call sites use the tracing wrapper and no other file calls those APIs directly', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync('lib/notifications/brevo-transactional.ts', 'utf8'), /tracedFetch\('brevo', 'https:\/\/api\.brevo\.com\/v3\/smtp\/email'/);
  assert.match(readFileSync('lib/news/thumbnail.ts', 'utf8'), /tracedFetch\('cloudinary', `https:\/\/api\.cloudinary\.com/);
});
