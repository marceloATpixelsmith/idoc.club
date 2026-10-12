import 'server-only';
import { client } from '@/lib/db/drizzle';

export type PostgresMetrics = {
  connections: number;
  transactionsCommitted: number;
  transactionsRolledBack: number;
  deadlocks: number;
  waitingLocks: number;
  databaseBytes: number;
  /** Cumulative totals per IDOC application role from pg_stat_statements; absent when the extension is missing or unreadable. */
  statements?: Array<{ role: string; calls: number; execMs: number }>;
  /** Render's own CPU and memory figures for the database instance; absent when the key is not set or the request fails. */
  render?: { cpuCores: number; cpuLimitCores: number; memoryBytes: number; memoryLimitBytes: number };
};

// Shared Render Postgres instance (a non-secret identifier). Render's API requires an account API key,
// which cannot be limited to one resource, so the key is read only here, only for these four GET
// requests, and is never logged or returned.
const RENDER_POSTGRES_ID = 'dpg-d3c3gd2li9vc73d8n3o0-a';
const RENDER_METRIC_PATHS = { cpuCores: 'cpu', cpuLimitCores: 'cpu-limit', memoryBytes: 'memory', memoryLimitBytes: 'memory-limit' } as const;

async function readRenderMetricValue(path: string, key: string, nowMs: number): Promise<number | undefined> {
  const url = new URL(`https://api.render.com/v1/metrics/${path}`);
  url.searchParams.set('resource', RENDER_POSTGRES_ID);
  // Render's API specification types these as RFC 3339 date-time strings.
  const rfc3339 = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  url.searchParams.set('startTime', rfc3339(nowMs - 15 * 60_000));
  url.searchParams.set('endTime', rfc3339(nowMs));
  url.searchParams.set('resolutionSeconds', '60');
  const response = await fetch(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (!response.ok) return undefined;
  const series = (await response.json()) as Array<{ values?: Array<{ value?: unknown }> }>;
  const latest = series?.[0]?.values?.at(-1)?.value;
  return typeof latest === 'number' && Number.isFinite(latest) && latest >= 0 ? latest : undefined;
}

// Optional by design: without RENDER_API_KEY, or if any request fails, the export continues without these gauges.
async function readRenderMetrics(nowMs: number): Promise<PostgresMetrics['render']> {
  const key = process.env.RENDER_API_KEY;
  if (!key) return undefined;
  try {
    const entries = await Promise.all(Object.entries(RENDER_METRIC_PATHS).map(async ([field, path]) => [field, await readRenderMetricValue(path, key, nowMs)] as const));
    const values = Object.fromEntries(entries) as Record<keyof typeof RENDER_METRIC_PATHS, number | undefined>;
    if (Object.values(values).some((value) => value === undefined)) return undefined;
    return values as NonNullable<PostgresMetrics['render']>;
  } catch {
    return undefined;
  }
}

// Built-in aggregate statistics only. No SQL text, member records, credentials or
// per-session details. Values are for the SHARED database, not solely IDOC.
export async function readPostgresMetrics(): Promise<PostgresMetrics> {
  const rows = await client`
    SELECT
      d.numbackends::float8 AS connections,
      d.xact_commit::float8 AS committed,
      d.xact_rollback::float8 AS rolled_back,
      d.deadlocks::float8 AS deadlocks,
      pg_database_size(current_database())::float8 AS db_bytes,
      (SELECT count(*)::float8 FROM pg_locks WHERE NOT granted) AS waiting_locks
    FROM pg_stat_database d WHERE d.datname = current_database()
  `;
  const r = rows[0];
  if (!r) throw new Error('PostgreSQL statistics unavailable');
  return {
    statements: await readStatementAggregates(),
    render: await readRenderMetrics(Date.now()),
    connections: Number(r.connections),
    transactionsCommitted: Number(r.committed),
    transactionsRolledBack: Number(r.rolled_back),
    deadlocks: Number(r.deadlocks),
    waitingLocks: Number(r.waiting_locks),
    databaseBytes: Number(r.db_bytes),
  };
}

// Cumulative totals only (calls and total execution time) per IDOC application role (`idoc_*`), so
// shared-database maintenance and tooling traffic is excluded and New Relic derives the recent
// average from the change between hourly points rather than from lifetime per-statement averages.
// The extension lives in the `public` schema and the application roles' search_path does not include it, so the name is qualified. The statement text column is never selected. Optional by design: if pg_stat_statements is not
// installed or the role cannot read it, the export continues without these gauges.
async function readStatementAggregates(): Promise<PostgresMetrics['statements']> {
  try {
    const rows = await client`
      SELECT r.rolname AS role, sum(s.calls)::float8 AS calls, sum(s.total_exec_time)::float8 AS exec_ms
      FROM public.pg_stat_statements s
      JOIN pg_roles r ON r.oid = s.userid
      WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND starts_with(r.rolname, 'idoc_')
      GROUP BY r.rolname
    `;
    const result = rows
      .map((r) => ({ role: String(r.role), calls: Number(r.calls), execMs: Number(r.exec_ms) }))
      .filter((r) => /^idoc_[a-z0-9_]+$/.test(r.role));
    return result.length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

export function postgresMetricsPayload(values: PostgresMetrics, timeMs: number) {
  const timeUnixNano = (BigInt(timeMs) * 1_000_000n).toString();
  const definitions = [
    ['postgres.connections', values.connections, '1'],
    ['postgres.transactions.committed', values.transactionsCommitted, '1'],
    ['postgres.transactions.rolled_back', values.transactionsRolledBack, '1'],
    ['postgres.deadlocks', values.deadlocks, '1'],
    ['postgres.locks.waiting', values.waitingLocks, '1'],
    ['postgres.database.size', values.databaseBytes, 'By'],
  ] as const;
  const render = values.render;
  const renderDefinitions = render ? [
    ['postgres.cpu.usage', render.cpuCores, '1'],
    ['postgres.cpu.limit', render.cpuLimitCores, '1'],
    ['postgres.memory.usage', render.memoryBytes, 'By'],
    ['postgres.memory.limit', render.memoryLimitBytes, 'By'],
  ] as const : [];
  const statements = values.statements ?? [];
  if (renderDefinitions.some(([, value]) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Invalid PostgreSQL statistics');
  }
  if (definitions.some(([, value]) => !Number.isFinite(value) || value < 0)
    || statements.some((row) => !Number.isFinite(row.calls) || !Number.isFinite(row.execMs) || row.calls < 0 || row.execMs < 0)) {
    throw new Error('Invalid PostgreSQL statistics');
  }
  const statementGauge = (name: string, unit: string, pick: (row: { calls: number; execMs: number }) => number) => ({
    name, unit,
    gauge: { dataPoints: statements.map((row) => ({
      timeUnixNano, asDouble: pick(row),
      attributes: [{ key: 'db.role', value: { stringValue: row.role } }],
    })) },
  });
  return {
    resourceMetrics: [{
      resource: { attributes: [
        { key: 'service.name', value: { stringValue: 'idoc.club-postgres' } },
        { key: 'db.system', value: { stringValue: 'postgresql' } },
        { key: 'deployment.environment', value: { stringValue: 'staging' } },
        { key: 'db.scope', value: { stringValue: 'shared' } },
      ] },
      scopeMetrics: [{
        scope: { name: 'postgres.aggregate.stats' },
        metrics: [
          ...definitions.map(([name, value, unit]) => ({
            name, unit,
            gauge: { dataPoints: [{ timeUnixNano, asDouble: value }] },
          })),
          ...renderDefinitions.map(([name, value, unit]) => ({
            name, unit,
            gauge: { dataPoints: [{ timeUnixNano, asDouble: value }] },
          })),
          ...(statements.length > 0 ? [
            statementGauge('postgres.statements.calls', '1', (row) => row.calls),
            statementGauge('postgres.statements.exec_time', 'ms', (row) => row.execMs),
          ] : []),
        ],
      }],
    }],
  };
}
