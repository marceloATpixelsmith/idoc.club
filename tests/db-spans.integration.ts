import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import type { Tracer } from '@opentelemetry/api';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import postgres from 'postgres';
import { traceClient } from '../lib/observability/db-spans.ts';

// Runs the wrapper against the real Postgres.js client (the wrapper relies on its Query internals) and through Drizzle.
const url = process.env.TEST_DATABASE_URL;
assert.ok(url, 'TEST_DATABASE_URL is required');
const raw = postgres(url, { max: 2, onnotice: () => undefined });
const spans: Array<{ attributes: Record<string, unknown>; ended: number; name: string; status?: number }> = [];
const tracer = {
  startSpan: (name: string, options: { attributes?: Record<string, unknown> }) => {
    const record: { attributes: Record<string, unknown>; ended: number; name: string; status?: number } = { attributes: { ...options.attributes }, ended: 0, name };
    spans.push(record);
    return {
      end: () => { record.ended += 1; },
      setAttribute: (key: string, value: unknown) => { record.attributes[key] = value; },
      setStatus: (status: { code: number }) => { record.status = status.code; },
    };
  },
} as unknown as Tracer;
const client = traceClient(raw, tracer);
const db = drizzle(client);
after(async () => { await raw.end({ timeout: 2 }); });

const names = () => spans.map((span) => span.name);

test('tagged templates, awaited results and fragments behave exactly as before, with one span per query that runs', async () => {
  spans.length = 0;
  const fragment = client`and 1 = 1`;
  const rows = await client`select ${1}::int as n where true ${fragment}`;
  assert.deepEqual(rows.map((row) => row.n), [1]);
  assert.deepEqual(names(), ['postgres SELECT'], 'the fragment did not run on its own');
  assert.equal(spans[0].ended, 1);
  assert.equal(spans[0].attributes['db.rows'], 1);
});

test('Drizzle queries, including values() and transactions, are traced and return the same data', async () => {
  spans.length = 0;
  const result = await db.execute(drizzleSql`select 2::int as n`);
  assert.equal(result[0].n, 2);
  const inTransaction = await db.transaction(async (tx) => (await tx.execute(drizzleSql`select 3::int as n`))[0].n);
  assert.equal(inTransaction, 3);
  assert.ok(names().includes('postgres SELECT'));
  assert.ok(spans.every((span) => span.ended === 1), 'every span ended');
  assert.ok(spans.length >= 2);
});

test('a failing query still rejects with the original error and its span carries only the code', async () => {
  spans.length = 0;
  await assert.rejects(() => client`select * from idoc.table_that_does_not_exist_for_span_test`, (error: { code?: string }) => error.code === '42P01');
  assert.equal(spans.length, 1);
  assert.equal(spans[0].ended, 1);
  assert.equal(spans[0].attributes['db.error.code'], '42P01');
  assert.equal(spans[0].status, 2);
  assert.ok(!JSON.stringify(spans[0]).includes('table_that_does_not_exist'));
});
