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

// Cumulative totals only (calls and total execution time) per IDOC application role (`idoc_*`), so
// shared-database maintenance and tooling traffic is excluded and New Relic derives the recent
// average from the change between hourly points rather than from lifetime per-statement averages.
// The statement text column is never selected. Optional by design: if pg_stat_statements is not
// installed or the role cannot read it, the export continues without these gauges.
async function readStatementAggregates(): Promise<PostgresMetrics['statements']> {
  try {
    const rows = await client`
      SELECT r.rolname AS role, sum(s.calls)::float8 AS calls, sum(s.total_exec_time)::float8 AS exec_ms
      FROM pg_stat_statements s
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
  const statements = values.statements ?? [];
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
          ...(statements.length > 0 ? [
            statementGauge('postgres.statements.calls', '1', (row) => row.calls),
            statementGauge('postgres.statements.exec_time', 'ms', (row) => row.execMs),
          ] : []),
        ],
      }],
    }],
  };
}
