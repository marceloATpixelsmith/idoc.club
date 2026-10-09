import 'server-only';
import { client } from '@/lib/db/drizzle';

export type PostgresMetrics = {
  connections: number;
  transactionsCommitted: number;
  transactionsRolledBack: number;
  deadlocks: number;
  waitingLocks: number;
  databaseBytes: number;
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
    connections: Number(r.connections),
    transactionsCommitted: Number(r.committed),
    transactionsRolledBack: Number(r.rolled_back),
    deadlocks: Number(r.deadlocks),
    waitingLocks: Number(r.waiting_locks),
    databaseBytes: Number(r.db_bytes),
  };
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
        scope: { name: 'idoc.postgres.stats' },
        metrics: definitions.map(([name, value, unit]) => ({
          name, unit,
          gauge: { dataPoints: [{ timeUnixNano, asDouble: value }] },
        })),
      }],
    }],
  };
}
