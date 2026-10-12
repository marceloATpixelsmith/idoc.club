import 'server-only';
import { client } from '@/lib/db/drizzle';

export type PostgresMetrics = {
  connections: number;
  transactionsCommitted: number;
  transactionsRolledBack: number;
  deadlocks: number;
  waitingLocks: number;
  databaseBytes: number;
  /** Aggregates from pg_stat_statements; absent when the extension is missing or unreadable. */
  statements?: { tracked: number; slowestMeanMs: number; slowCount: number };
};

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
    connections: Number(r.connections),
    transactionsCommitted: Number(r.committed),
    transactionsRolledBack: Number(r.rolled_back),
    deadlocks: Number(r.deadlocks),
    waitingLocks: Number(r.waiting_locks),
    databaseBytes: Number(r.db_bytes),
  };
}

// Counts and timings only: the statement text column is never selected, and statements called fewer
// than five times (one-off migrations, schema introspection) are ignored for the slow figures.
// Optional by design: if pg_stat_statements is not installed or the role cannot read it, the
// export continues without these three gauges.
async function readStatementAggregates(): Promise<PostgresMetrics['statements']> {
  try {
    const rows = await client`
      SELECT
        count(*)::float8 AS tracked,
        coalesce(max(mean_exec_time) FILTER (WHERE calls >= 5), 0)::float8 AS slowest_mean_ms,
        count(*) FILTER (WHERE calls >= 5 AND mean_exec_time > 1000)::float8 AS slow_count
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    `;
    const r = rows[0];
    if (!r) return undefined;
    return { tracked: Number(r.tracked), slowestMeanMs: Number(r.slowest_mean_ms), slowCount: Number(r.slow_count) };
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
    ...(values.statements ? [
      ['postgres.statements.tracked', values.statements.tracked, '1'],
      ['postgres.statements.slowest_mean', values.statements.slowestMeanMs, 'ms'],
      ['postgres.statements.slow', values.statements.slowCount, '1'],
    ] as const : []),
  ] as const;
  if (definitions.some(([, value]) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Invalid PostgreSQL statistics');
  }
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
        metrics: definitions.map(([name, value, unit]) => ({
          name, unit,
          gauge: { dataPoints: [{ timeUnixNano, asDouble: value }] },
        })),
      }],
    }],
  };
}
