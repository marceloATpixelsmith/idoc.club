# Schema-isolation execution checklist (NOT YET READY FOR CUTOVER)

The IDOC redesign runs on Render PostgreSQL in the shared `idoc` schema today. Live WordPress is separate.

## Current schema inventory

Read-only Render inspection on 2026-10-08 found 55 tables, 42 sequences, no views or materialized views, and approximately 7.4 MB of total `idoc` relation storage. This is not an authorization to change the database.

## Runtime blockers to fix before switching DB_SCHEMA

The current Drizzle table model in `lib/db/schema.ts` declares `pgSchema('idoc')`, irrespective of `DB_SCHEMA`. The direct SQL in `lib/auth/session-registry.ts`, `lib/notifications/account-delivery.ts`, and `lib/payments/customer-email.ts` also explicitly qualifies tables using `idoc.`. Every runtime SQL entry point must be inventoried and adapted, including auth, member billing, seminar operations, audit logs, outbox workers and raw SQL used by server actions. Setting a PostgreSQL search_path will not fix explicit schema qualifications.

All historical Drizzle migrations currently include literal `idoc` schema identifiers. A copy must preserve migration journal state; migrations in the future need an approved schema-parametric execution strategy. Do not rewrite the historical migration snapshots casually.

## Proposed rollout (not executed)

1. Prepare a verified `pg_dump` backup of Render database `ayni_space`; rehearse restore to an isolated temporary database.
2. Prove schema-qualified runtime isolation through automated integration tests.
3. Gate outbound staging email, live Stripe calls and copied background queues. Invalidate cloned sessions and recovery/OTP artifacts.
4. Coordinate a brief pause of the redesign's writing workers and any affected Next.js deployments. WordPress is not involved.
5. Rename `idoc` to `idoc_production`, using a tested explicit rollback path if application verification fails.
6. Clone the entire schema into `idoc_staging` with all required schema objects and a consistent dataset, checking references, sequences, privileges, and migration history.
7. Set environment-specific Vercel `DB_SCHEMA=idoc_production` for future production and `DB_SCHEMA=idoc_staging` for the staging branch Preview, then redeploy each environment. Maintain existing backups and rollback until verified.
8. Test reads, writes, login, members, seminar registration, Stripe test-mode and notifications for zero cross-schema effects. Only then register staging QStash recurring jobs.
9. Do not cut over Vercel Cron until the QStash schedule registration and signed delivery paths are proven.

The Render MCP integration is read-only and cannot execute the dump, rename or clone. The sole purpose of the accompanying preflight script is to inventory metadata without mutating records.
