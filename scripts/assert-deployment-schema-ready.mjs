#!/usr/bin/env node
//ASSERT DATABASE SCHEMA READINESS BEFORE BUILDING A VERCEL DEPLOYMENT.
//NEVER RUN MIGRATIONS WITH APPLICATION CREDENTIALS OR DURING A VERCEL BUILD.
//A FAILED CHECK PREVENTS THE NEW DEPLOYMENT FROM REPLACING THE LAST WORKING ONE.

import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const deployment = process.env.VERCEL_ENV;
const branch = process.env.VERCEL_GIT_COMMIT_REF;
const target = deployment === 'production'
  ? 'idoc_production'
  : deployment === 'preview' && branch === 'staging'
    ? 'idoc_staging'
    : null;

if (target === null)
{
  console.log('Deployment schema gate: not an IDOC staging/production deployment; skipped.');
}
else
{
  const configured = process.env.DB_SCHEMA;
  if (configured !== target)
  {
    throw new Error(`Deployment schema gate: expected DB_SCHEMA=${target}, got ${configured ?? '(unset)'}.`);
  }

  const rawUrl = process.env.POSTGRES_URL;
  if (!rawUrl)
  {
    throw new Error('Deployment schema gate: POSTGRES_URL is not configured.');
  }

  const url = new URL(rawUrl);
  const expectedRole = target === 'idoc_production' ? 'idoc_production_app' : 'idoc_staging_app';
  if (decodeURIComponent(url.username) !== expectedRole)
  {
    throw new Error('Deployment schema gate: database application role does not match deployment environment.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && !url.searchParams.has('sslmode'))
  {
    url.searchParams.set('sslmode', 'require');
  }

  const journal = JSON.parse(await readFile(new URL('../lib/db/migrations/meta/_journal.json', import.meta.url), 'utf8'));
  const expected = Math.max(...journal.entries.map((entry) => Number(entry.when)));
  if (!Number.isSafeInteger(expected) || expected <= 0)
  {
    throw new Error('Deployment schema gate: invalid committed migration journal.');
  }

  const db = postgres(url.toString(), {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    connection: { application_name: 'idoc-deployment-schema-gate' },
  });
  try
  {
    const rows = await db.unsafe(`select created_at::bigint as applied from "${target}".__drizzle_migrations`);
    const applied = new Set(rows.map((row) => Number(row.applied)));
    const actual = rows.length ? Math.max(...applied) : null;
    if (actual !== expected)
    {
      throw new Error(`Deployment schema gate: ${target} migrations are not ready (applied=${actual ?? 'none'}; required=${expected}). Approve/complete the protected database migration job, then redeploy.`);
    }
    //LEGACY MIGRATION LEDGERS ARE HISTORICALLY RECONCILED THROUGH 0070.
    //REQUIRE EVERY COMMITTED MIGRATION AFTER 0070, NOT JUST THE NEWEST ONE.
    const required = journal.entries.filter((entry) => entry.idx >= 71);
    const missingMigrations = required.filter((entry) => !applied.has(Number(entry.when))).map((entry) => entry.tag);
    if (missingMigrations.length)
    {
      throw new Error(`Deployment schema gate: ${target} is missing committed migrations: ${missingMigrations.join(', ')}.`);
    }

    //THE HISTORIC LEDGER MAY CONTAIN RECONCILED ROWS; VERIFY CRITICAL TABLES, NOT ONLY A TIMESTAMP.
    const requiredTables = [
      'email_delivery_log',
      'email_delivery_events',
      'email_delivery_pending_events',
      'operational_alert_outbox',
    ];
    const found = await db`select table_name from information_schema.tables where table_schema = ${target} and table_name = any(${requiredTables}::text[])`;
    const names = new Set(found.map((row) => row.table_name));
    const missing = requiredTables.filter((name) => !names.has(name));
    if (missing.length)
    {
      throw new Error(`Deployment schema gate: required ${target} tables are missing: ${missing.join(', ')}.`);
    }
    console.log(`Deployment schema gate: ${target} verified at migration timestamp ${expected}; critical tables present.`);
  }
  catch (error)
  {
    console.error('Deployment schema gate FAILED. The new deployment must not serve traffic until its migrations are applied.', error);
    process.exitCode = 1;
  }
  finally
  {
    await db.end({ timeout: 5 });
  }
}
