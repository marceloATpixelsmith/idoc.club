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

const journal = JSON.parse(await readFile('lib/db/migrations/meta/_journal.json', 'utf8'));
const historicalEntries = journal.entries.filter(entry => entry.idx <= 70);
if (historicalEntries.length !== 71 || journal.entries.find(entry => entry.idx === 71)?.tag !== '0071_permanent_data_promotion')
{
    throw new Error('Unexpected repository migration journal');
}
const normalizeRows = rows => rows.map(row => [Number(row.created_at), row.hash]);
async function expectedHistory(targetSchema)
{
    const expected = await Promise.all(historicalEntries.map(async entry =>
    {
        const file = await readFile('lib/db/migrations/' + entry.tag + '.sql', 'utf8');
        const rewritten = rewriteMigrationSql(file, targetSchema);
        return [entry.when, createHash('sha256').update(rewritten).digest('hex')];
    }));
    return expected.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
}
function assertHistory(actual, expected, label)
{
    if (JSON.stringify(normalizeRows(actual)) !== JSON.stringify(expected))
    {
        throw new Error(label + ' ledger differs from committed migration journal (timestamps or hashes). Reconcile actual applied SQL and schema before attempting migration 0071');
    }
}


async function verifyInstalledMigration(tx,targetSchema,expectedHash)
{
        const result = await tx`SELECT
            (SELECT COUNT(*)::integer FROM information_schema.columns
                WHERE table_schema = ${targetSchema} AND table_name IN ('news_articles','seminars')
                AND column_name = 'promotion_key' AND data_type = 'uuid' AND is_nullable = 'NO'
                AND column_default LIKE '%gen_random_uuid%') AS uuid_columns,
            (SELECT COUNT(*)::integer FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = ${targetSchema} AND c.contype = 'u'
                AND ((t.relname = 'news_articles' AND c.conname = 'news_articles_promotion_key_unique')
                  OR (t.relname = 'seminars' AND c.conname = 'seminars_promotion_key_unique'))) AS unique_constraints,
            (SELECT COUNT(*)::integer FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = ${targetSchema}
                  AND p.proname IN ('lock_promotion_source','lock_seminars_for_promotion')
                  AND p.prosecdef
                  AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a
                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS protected_functions,
            (SELECT COUNT(*)::integer FROM pg_class t
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = ${targetSchema} AND t.relname = 'promotion_audit_success'
                AND t.relkind = 'v' AND 'security_barrier=true' = ANY(COALESCE(t.reloptions, ARRAY[]::text[]))
                AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl,acldefault('r',t.relowner))) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'SELECT')) AS protected_audit_views`;
        const ledger = await tx.unsafe('SELECT COUNT(*)::integer AS count FROM "' + targetSchema + '".__drizzle_migrations WHERE created_at = $1 AND hash = $2', [1791566400000, expectedHash]);
        if (result[0].uuid_columns !== 2 || result[0].unique_constraints !== 2 ||
            result[0].protected_functions !== 2 || result[0].protected_audit_views !== 1 ||
            ledger[0].count !== 1)
        {
            throw new Error('Migration 0071 invariant validation failed for ' + targetSchema);
        }
        return { uuidColumns: result[0].uuid_columns, uniqueConstraints: result[0].unique_constraints,
            protectedFunctions: result[0].protected_functions, protectedAuditViews: result[0].protected_audit_views,
            ledgerEntries: ledger[0].count };
}

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
    const validation = await sql.begin(async tx =>
    {
        await tx`SELECT pg_advisory_xact_lock(71071, ${schema === 'idoc_staging' ? 1 : 2})`;
        const historical = await tx.unsafe('SELECT created_at, hash FROM "' + schema + '".__drizzle_migrations ORDER BY created_at, hash');
        assertHistory(historical, await expectedHistory(schema), schema);
        if (schema === 'idoc_production')
        {
            const stagingLedger = await tx.unsafe('SELECT created_at, hash FROM idoc_staging.__drizzle_migrations ORDER BY created_at, hash');
            const stagingHash = createHash('sha256').update(rewriteMigrationSql(await readFile('lib/db/migrations/0071_permanent_data_promotion.sql', 'utf8'), 'idoc_staging')).digest('hex');
            const expectedStaging = [...await expectedHistory('idoc_staging'), [1791566400000, stagingHash]];
            assertHistory(stagingLedger, expectedStaging, 'idoc_staging (must be migrated first)');
            await verifyInstalledMigration(tx, 'idoc_staging', stagingHash);
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
        return await verifyInstalledMigration(tx, schema, hash);
    });
    console.log(JSON.stringify({ result: 'migration_0071_applied', schema, backupReference: reference,
        database: identity[0].database, operator: identity[0].operator, verification: validation }));
}
finally
{
    await sql.end({ timeout: 5 });
}
