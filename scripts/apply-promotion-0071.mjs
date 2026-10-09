#!/usr/bin/env node
// MANUAL, SCHEMA-BOUND MIGRATION 0071 RUNNER. NEVER RUN FROM AN APPLICATION BUILD.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { rewriteMigrationSql } from './schema-migration-sql.mjs';

const schema = process.env.PROMOTION_TARGET_SCHEMA;
const reference = process.env.PROMOTION_BACKUP_REFERENCE?.trim();
const confirmation = process.env.PROMOTION_CONFIRM;
const url = process.env.IDOC_MIGRATION_DATABASE_URL;
if (!['idoc_staging', 'idoc_production'].includes(schema))
{
    throw new Error('PROMOTION_TARGET_SCHEMA must be idoc_staging or idoc_production');
}
if (confirmation !== `APPLY-0071-${schema}`)
{
    throw new Error('Explicit schema-specific confirmation is required');
}
if (!reference || reference.length < 8 || /^(none|unknown|pending|not available)$/i.test(reference))
{
    throw new Error('A verified database backup reference is required');
}
if (!url)
{
    throw new Error('Missing IDOC_MIGRATION_DATABASE_URL secret');
}

const ledgerBaseline = JSON.parse(await readFile('scripts/migration-0071-ledger-baseline.json', 'utf8'));
const normalizeRows = rows => rows.map(row => [Number(row.created_at), row.hash]);
const assertBaseline = (actual, expected, label) =>
{
    if (JSON.stringify(normalizeRows(actual)) !== JSON.stringify(expected))
    {
        throw new Error(label + ' migration history does not match the frozen 0070 baseline; investigate before migrating');
    }
};

const sql = postgres(url, { max: 1, connect_timeout: 15, connection: { application_name: 'idoc-promotion-0071-maintenance' } });
try
{
    const identity = await sql`SELECT current_database() AS database, current_user AS operator,
        EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${schema}) AS schema_exists`;
    if (identity[0].database !== 'ayni_space' || !identity[0].schema_exists)
    {
        throw new Error('Wrong database or missing target schema');
    }
    const migration = rewriteMigrationSql(await readFile('lib/db/migrations/0071_permanent_data_promotion.sql', 'utf8'), schema);
    const statements = migration.split('--> statement-breakpoint').map(x => x.trim()).filter(Boolean);
    const hash = createHash('sha256').update(migration).digest('hex');
    // THE SCRIPT IS CHECKED OUT FROM THE PROTECTED STAGING BRANCH ONLY.
    await sql.begin(async tx =>
    {
        await tx`SELECT pg_advisory_xact_lock(71071, ${schema === 'idoc_staging' ? 1 : 2})`;
        const historical = await tx.unsafe('SELECT created_at, hash FROM "' + schema + '".__drizzle_migrations ORDER BY created_at, hash');
        assertBaseline(historical, ledgerBaseline[schema], schema);
        if (schema === 'idoc_production')
        {
            const stagingLedger = await tx.unsafe('SELECT created_at, hash FROM idoc_staging.__drizzle_migrations ORDER BY created_at, hash');
            const stagingHash = createHash('sha256').update(rewriteMigrationSql(await readFile('lib/db/migrations/0071_permanent_data_promotion.sql', 'utf8'), 'idoc_staging')).digest('hex');
            const expectedStaging = [...ledgerBaseline.idoc_staging, [1791566400000, stagingHash]];
            assertBaseline(stagingLedger, expectedStaging, 'idoc_staging (must be migrated first)');
            const stagingObjects = await tx.unsafe(`SELECT
                (SELECT COUNT(*)::integer FROM information_schema.columns WHERE table_schema = 'idoc_staging'
                 AND table_name IN ('news_articles', 'seminars') AND column_name = 'promotion_key'
                 AND is_nullable = 'NO') AS columns,
                to_regprocedure('idoc_staging.lock_promotion_source(text,bigint)') IS NOT NULL AS source_lock,
                to_regprocedure('idoc_staging.lock_seminars_for_promotion()') IS NOT NULL AS seminar_lock,
                to_regclass('idoc_staging.promotion_audit_success') IS NOT NULL AS audit_view`);
            if (stagingObjects[0].columns !== 2 || !stagingObjects[0].source_lock ||
                !stagingObjects[0].seminar_lock || !stagingObjects[0].audit_view)
            {
                throw new Error('Staging 0071 objects are incomplete; Production migration blocked');
            }
        }
        const existing = await tx`SELECT
            (SELECT COUNT(*)::integer FROM information_schema.columns
             WHERE table_schema = ${schema} AND table_name IN ('news_articles','seminars')
               AND column_name = 'promotion_key') AS columns`;
        if (existing[0].columns !== 0)
        {
            throw new Error('Migration 0071 is already present or partially present: stop for investigation');
        }
        // INVOKE postgres.js unsafe() WITH ONE SERVER-SIDE TRANSACTION.
        for (const statement of statements)
        {
            await tx.unsafe(statement);
        }
        await tx.unsafe('INSERT INTO "' + schema + '".__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [hash, 1791566400000]);
        const result = await tx`SELECT (SELECT COUNT(*)::integer FROM information_schema.columns
            WHERE table_schema = ${schema} AND table_name IN ('news_articles','seminars')
            AND column_name = 'promotion_key' AND is_nullable = 'NO') AS columns`;
        if (result[0].columns !== 2)
        {
            throw new Error('Post-migration schema validation failed; transaction will roll back');
        }
    });
    console.log(JSON.stringify({ result: 'migration_0071_applied', schema, backupReference: reference,
        database: identity[0].database, operator: identity[0].operator }));
}
finally
{
    await sql.end({ timeout: 5 });
}
