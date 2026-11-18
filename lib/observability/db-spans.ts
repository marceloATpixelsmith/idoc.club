import 'server-only';

import { SpanKind, SpanStatusCode, context, trace, type Span, type Tracer } from '@opentelemetry/api';

/** The Postgres.js client has no OpenTelemetry instrumentation, so time spent waiting on the database (a new connection, a busy
 * pool, a slow query) was invisible: a page render that stalled for 40 seconds showed one long span with nothing under it. This
 * wraps the client so each query that actually runs records one CLIENT span.
 *
 * Privacy: a span carries only `db.system`, a fixed `db.operation` keyword taken from an allowlist (never the SQL text, table
 * or column names, parameters or any error message, all of which can hold member data), the returned row count, and on failure
 * the error code (for example the SQLSTATE `23505` or the client's `CONNECT_TIMEOUT`). These are CLIENT spans, so the staging
 * and production alerts and the weekly health check, which all read `span.kind = 'server'`, are unaffected.
 *
 * Postgres.js runs a query only when it is awaited (or `execute`, `forEach` or `cursor` is called), so a query used as a
 * fragment inside another query never runs by itself and gets no span. The span starts at that moment, which includes any wait
 * for a free connection, and ends when the library settles the query. Every step is defensive: tracing must never change or
 * break a query, so an unrecognised object is returned untouched. */

const OPERATIONS = new Set(['ALTER', 'BEGIN', 'COMMIT', 'CREATE', 'DELETE', 'DROP', 'INSERT', 'LOCK', 'ROLLBACK', 'SELECT', 'SET', 'SHOW', 'TRUNCATE', 'UPDATE', 'WITH']);
const ERROR_CODE = /^[A-Z0-9_]{3,40}$/;

type QueryLike = {
  executed?: boolean;
  handle: () => unknown;
  reject: (error: unknown) => unknown;
  resolve: (value: unknown) => unknown;
  strings?: unknown;
};

/** The leading SQL keyword, kept only when it is in the allowlist. */
export function dbOperation(strings: unknown): string {
  const text = Array.isArray(strings) ? String(strings[0] ?? '') : typeof strings === 'string' ? strings : '';
  const keyword = /^\s*([a-z]+)/i.exec(text)?.[1]?.toUpperCase();
  return keyword && OPERATIONS.has(keyword) ? keyword : 'OTHER';
}

function isQuery(value: unknown): value is QueryLike {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.handle === 'function' && typeof candidate.resolve === 'function' && typeof candidate.reject === 'function' && 'executed' in candidate;
}

/** Marks a span as failed with only the error's short code (a SQLSTATE or the client's `CONNECT_TIMEOUT`), never its message. */
function markError(span: Span, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && ERROR_CODE.test(code)) span.setAttribute('db.error.code', code);
  span.setStatus({ code: SpanStatusCode.ERROR });
}

/** Times a whole Postgres.js transaction. Its `begin` waits for a free connection and runs BEGIN, COMMIT and ROLLBACK on the
 * library's own internal client, which this wrapper cannot see, so the single span around the call is what shows a stall while
 * acquiring the connection (including a `CONNECT_TIMEOUT` before the callback ever runs). The queries inside the callback nest
 * under it. The caller sees the original result or the original error. */
function traceTransaction<R>(run: () => Promise<R>, tracer: Tracer): Promise<R> {
  let span: Span | undefined;
  try {
    span = tracer.startSpan('postgres TRANSACTION', { kind: SpanKind.CLIENT, attributes: { 'db.system': 'postgresql', 'db.operation': 'TRANSACTION' } });
  } catch { span = undefined; }
  if (!span) return run();
  const started = span;
  const finish = (error?: unknown) => {
    try {
      if (error !== undefined) markError(started, error);
      started.end();
    } catch { /* a tracing failure must never reach the transaction */ }
  };
  let result: Promise<R>;
  try {
    result = context.with(trace.setSpan(context.active(), started), run);
  } catch (error) {
    finish(error ?? new Error('transaction failed'));
    throw error;
  }
  return result.then(
    (value) => { finish(); return value; },
    (error: unknown) => { finish(error ?? new Error('transaction failed')); throw error; },
  );
}

/** Adds a timing span to one Postgres.js query, started when the query really runs. Returns the same object. */
export function traceQuery<T>(query: T, tracer: Tracer = trace.getTracer('idoc-db')): T {
  if (!isQuery(query)) return query;
  try {
    const handle = query.handle;
    const resolve = query.resolve;
    const reject = query.reject;
    let span: Span | undefined;
    const finish = (error?: unknown, value?: unknown) => {
      const current = span;
      span = undefined;
      if (!current) return;
      try {
        const rows = (value as { count?: unknown } | undefined)?.count;
        if (typeof rows === 'number') current.setAttribute('db.rows', rows);
        if (error !== undefined) markError(current, error);
        current.end();
      } catch { /* a tracing failure must never reach the query */ }
    };
    query.handle = function tracedHandle() {
      if (!query.executed && !span) {
        try {
          const operation = dbOperation(query.strings);
          span = tracer.startSpan(`postgres ${operation}`, { kind: SpanKind.CLIENT, attributes: { 'db.system': 'postgresql', 'db.operation': operation } });
        } catch { span = undefined; }
      }
      return handle.call(query);
    };
    query.resolve = (value: unknown) => { finish(undefined, value); return resolve.call(query, value); };
    query.reject = (error: unknown) => { finish(error ?? new Error('query failed')); return reject.call(query, error); };
  } catch { /* leave the query exactly as the library made it */ }
  return query;
}

type Callable = (...args: never[]) => unknown;

/** Wraps a Postgres.js client (or a transaction's client) so every query it runs is timed: tagged templates, `unsafe` (which
 * Drizzle uses for all of its queries) and transactions (one span around the whole `begin`, plus spans for the queries on the client
 * handed to its callback). Everything else passes straight through. */
export function traceClient<T extends Callable>(client: T, tracer: Tracer = trace.getTracer('idoc-db')): T {
  return new Proxy(client, {
    apply: (target, thisArg, args) => traceQuery(Reflect.apply(target as Callable, thisArg, args), tracer),
    get: (target, property) => {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      if (property === 'unsafe') return (...args: unknown[]) => traceQuery(Reflect.apply(value, target, args), tracer);
      if (property === 'begin') {
        return (...args: unknown[]) => {
          const callback = args.at(-1);
          if (typeof callback === 'function') args[args.length - 1] = (transaction: Callable, ...rest: unknown[]) => callback(traceClient(transaction, tracer), ...rest);
          return traceTransaction(() => Reflect.apply(value, target, args) as Promise<unknown>, tracer);
        };
      }
      return value;
    },
  });
}
