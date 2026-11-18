import assert from 'node:assert/strict';
import test from 'node:test';
import { SpanStatusCode, type Tracer } from '@opentelemetry/api';
import { dbOperation, traceClient, traceQuery } from '../lib/observability/db-spans.ts';

type Recorded = { attributes: Record<string, unknown>; ended: number; kind?: number; name: string; status?: number };

function fakeTracer() {
  const spans: Recorded[] = [];
  const tracer = {
    startSpan: (name: string, options: { attributes?: Record<string, unknown>; kind?: number }) => {
      const record: Recorded = { attributes: { ...options.attributes }, ended: 0, kind: options.kind, name };
      spans.push(record);
      return {
        end: () => { record.ended += 1; },
        setAttribute: (key: string, value: unknown) => { record.attributes[key] = value; },
        setStatus: (status: { code: number }) => { record.status = status.code; },
      };
    },
  } as unknown as Tracer;
  return { spans, tracer };
}

/** Mirrors the parts of a Postgres.js `Query` the wrapper relies on: nothing runs until `handle`, then the library settles it. */
function fakeQuery(strings: unknown) {
  const query = {
    executed: false,
    handled: 0,
    strings,
    handle() { this.handled += 1; this.executed = true; },
    resolve(value: unknown) { return value; },
    reject(error: unknown) { return error; },
  };
  return query;
}

test('only the leading keyword of the SQL is kept, and only from the allowlist', () => {
  assert.equal(dbOperation(['select * from members where email = ', '']), 'SELECT');
  assert.equal(dbOperation('  UPDATE users SET password_hash = $1'), 'UPDATE');
  assert.equal(dbOperation(['with t as (select 1) select * from t']), 'WITH');
  assert.equal(dbOperation(['pg_advisory_xact_lock']), 'OTHER');
  assert.equal(dbOperation(['']), 'OTHER');
  assert.equal(dbOperation(undefined), 'OTHER');
});

test('a query that never runs (a fragment inside another query) gets no span', () => {
  const { spans, tracer } = fakeTracer();
  traceQuery(fakeQuery(['select 1']), tracer);
  assert.equal(spans.length, 0);
});

test('a query that runs records one client span with the operation and row count and nothing from the SQL', () => {
  const { spans, tracer } = fakeTracer();
  const query = traceQuery(fakeQuery(['select email from users where id = ', '']), tracer);
  query.handle();
  query.handle();
  assert.equal(spans.length, 1, 'a second handle call does not start a second span');
  assert.equal(spans[0].name, 'postgres SELECT');
  assert.equal(spans[0].kind, 2);
  query.resolve({ count: 3 });
  assert.equal(spans[0].ended, 1);
  assert.deepEqual(spans[0].attributes, { 'db.system': 'postgresql', 'db.operation': 'SELECT', 'db.rows': 3 });
  assert.equal(spans[0].status, undefined);
});

test('a failure marks the span as an error with a safe code and never records the message', () => {
  const { spans, tracer } = fakeTracer();
  const timeout = traceQuery(fakeQuery(['select 1']), tracer);
  timeout.handle();
  timeout.reject(Object.assign(new Error('connect to member-db.internal:5432 for user alice failed'), { code: 'CONNECT_TIMEOUT' }));
  assert.equal(spans[0].status, SpanStatusCode.ERROR);
  assert.equal(spans[0].attributes['db.error.code'], 'CONNECT_TIMEOUT');
  assert.ok(!JSON.stringify(spans[0]).includes('alice'));

  const odd = traceQuery(fakeQuery(['insert into t values (1)']), tracer);
  odd.handle();
  odd.reject(Object.assign(new Error('x'), { code: 'select * from members' }));
  assert.equal(spans[1].status, SpanStatusCode.ERROR);
  assert.equal(spans[1].attributes['db.error.code'], undefined, 'a code that is not a short identifier is dropped');
  assert.equal(spans[1].ended, 1);
});

test('values that are not queries pass through untouched', () => {
  const { spans, tracer } = fakeTracer();
  const builder = { first: 'x' };
  assert.equal(traceQuery(builder, tracer), builder);
  assert.equal(traceQuery(undefined, tracer), undefined);
  assert.equal(traceQuery(42, tracer), 42);
  assert.equal(spans.length, 0);
});

test('a client wrapper traces tagged templates, unsafe and the client handed to begin, and passes everything else through', async () => {
  const { spans, tracer } = fakeTracer();
  const transaction = Object.assign(() => fakeQuery(['insert into t values (1)']), { unsafe: () => fakeQuery('delete from t') });
  const base = Object.assign(() => fakeQuery(['select 1']), {
    end: () => 'ended',
    options: { max: 2 },
    unsafe: () => fakeQuery('update t set a = 1'),
    begin: async (callback: (client: typeof transaction) => unknown) => callback(transaction),
  });
  const client = traceClient(base, tracer);
  (client() as ReturnType<typeof fakeQuery>).handle();
  (client.unsafe() as ReturnType<typeof fakeQuery>).handle();
  assert.equal(client.end(), 'ended');
  assert.deepEqual(client.options, { max: 2 });
  await client.begin((tx) => {
    (tx() as unknown as ReturnType<typeof fakeQuery>).handle();
    (tx.unsafe() as unknown as ReturnType<typeof fakeQuery>).handle();
  });
  assert.deepEqual(spans.map((span) => span.name), ['postgres SELECT', 'postgres UPDATE', 'postgres INSERT', 'postgres DELETE']);
});

test('a tracer that throws never breaks the query', () => {
  const tracer = { startSpan: () => { throw new Error('tracer down'); } } as unknown as Tracer;
  const query = traceQuery(fakeQuery(['select 1']), tracer);
  query.handle();
  assert.equal(query.handled, 1);
  assert.deepEqual(query.resolve({ count: 1 }), { count: 1 });
});
