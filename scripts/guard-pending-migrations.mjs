#!/usr/bin/env node
// MANUAL MAINTENANCE GUARD for .github/workflows/manual-apply-migrations.yml. NEVER RUN FROM AN APPLICATION BUILD.
// Usage: node scripts/guard-pending-migrations.mjs before|after
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { rewriteMigrationSql } from './schema-migration-sql.mjs';

const phase = process.argv[2];
const schema = process.env.TARGET_SCHEMA;
const url = process.env.IDOC_MIGRATION_DATABASE_URL;
const LAST_RECONCILED_WHEN = 1791381600000; // 0070_news_article_audience: the ledger must already be at or past this.

if (!['before', 'after'].includes(phase)) throw new Error('Phase must be before or after');
if (!['idoc_staging', 'idoc_production'].includes(schema)) throw new Error('TARGET_SCHEMA must be idoc_staging or idoc_production');
if (!url) throw new Error('Missing IDOC_MIGRATION_DATABASE_URL secret');

const journal = JSON.parse(await readFile('lib/db/migrations/meta/_journal.json', 'utf8'));
const newestCommitted = Math.max(...journal.entries.map((entry) => entry.when));
const newestApplied = async (sql, targetSchema) => Number((await sql.unsafe(
  'SELECT max(created_at) AS newest FROM "' + targetSchema + '".__drizzle_migrations'))[0].newest);

const sql = postgres(url, { max: 1, connect_timeout: 15, connection: { application_name: 'idoc-pending-migrations-guard' } });
try {
  const identity = await sql`SELECT current_database() AS database,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${schema}) AS schema_exists`;
  if (identity[0].database !== 'ayni_space' || !identity[0].schema_exists) throw new Error('Wrong database or missing target schema');

  if (phase === 'after') {
    const newest = await newestApplied(sql, schema);
    console.log(JSON.stringify({ phase, schema, newestCommitted, newestApplied: newest }));
    if (newest !== newestCommitted) throw new Error('The ledger did not reach the newest committed migration');
    process.exit(0);
  }

  // Bind the migration connection to the server the mandatory backup was taken from.
  const fingerprint = await sql`SELECT md5(coalesce(inet_server_addr()::text,'') || ':' ||
    coalesce(inet_server_port()::text,'') || ':' || pg_postmaster_start_time()::text ||
    ':' || current_database() || ':' ||
    (SELECT oid::text FROM pg_database WHERE datname=current_database())) AS value`;
  if (!/^[a-f0-9]{32}$/.test(process.env.IDOC_BACKUP_SERVER_FINGERPRINT ?? '') ||
      fingerprint[0].value !== process.env.IDOC_BACKUP_SERVER_FINGERPRINT) {
    throw new Error('Pre-migration backup was taken from a different PostgreSQL server; migration refused');
  }

  const newest = await newestApplied(sql, schema);
  if (!(newest >= LAST_RECONCILED_WHEN)) {
    throw new Error('Ledger is behind migration 0070 (' + newest + '); migrations through 0070 must be applied and reconciled first');
  }

  // Report (do not fail on) historical ledger drift: the live ledgers are known to differ from the committed
  // history through 0070 (docs/15). The app is pre-launch with no real data, so pending migrations are applied
  // by timestamp; any drift is printed for the operator.
  const expected = new Set(await Promise.all(journal.entries.filter((entry) => entry.idx <= 70).map(async (entry) => {
    const file = await readFile('lib/db/migrations/' + entry.tag + '.sql', 'utf8');
    return entry.when + ':' + createHash('sha256').update(rewriteMigrationSql(file, schema)).digest('hex');
  })));
  const ledger = await sql.unsafe('SELECT created_at, hash FROM "' + schema + '".__drizzle_migrations');
  const unmatched = ledger.filter((row) => Number(row.created_at) <= LAST_RECONCILED_WHEN && !expected.has(Number(row.created_at) + ':' + row.hash)).length;
  console.log(JSON.stringify({ phase, schema, newestCommitted, newestApplied: newest, ledgerRows: ledger.length, historicalRowsNotMatchingCommittedSql: unmatched }));

  // Production may only be migrated after staging reached the newest committed migration.
  if (schema === 'idoc_production') {
    const staging = await newestApplied(sql, 'idoc_staging');
    if (staging !== newestCommitted) throw new Error('idoc_staging must be migrated to the newest committed migration before Production');
  }
} finally {
  await sql.end({ timeout: 5 });
}
