# Next.js redesign: PostgreSQL schema-isolation preflight

This applies only to the Next.js redesign at `redesign.idoc.club` and `staging.idoc.club`. The currently live WordPress site at `idoc.club` is a separate application.

## Verified Render database inventory (read-only, 2026-10-08)

- Render PostgreSQL database `ayni_space` contains application schema `idoc`, but neither `idoc_production` nor `idoc_staging`.
- The current `idoc` schema has **55 ordinary/partitioned tables**, **42 sequences**, **3 functions**, **4 user triggers**, **71 foreign keys**, and no materialized or ordinary views.
- `idoc` relations occupy approximately 7.4 MB; the whole database occupies approximately 35 MB.
- The Render MCP SQL tool is read-only; it cannot run DDL or create an export.

## Required code isolation

`lib/db/schema.ts` defines `pgSchema('idoc')`, so a `search_path` or connection setting alone does not isolate the Drizzle ORM. Raw SQL also explicitly references `idoc`. A sampled audit found hardcoded references in `lib/auth/session-registry.ts`, `lib/auth/mfa/store.ts`, `lib/auth/google-identity-linking.ts`, `lib/auth/google-account.ts`, `lib/auth/google-oidc-store.ts`, `lib/membership/account-recovery.ts`, `lib/membership/data-access.ts`, `lib/membership/admin-memberships.ts`, `lib/notifications/account-delivery.ts`, `lib/notifications/auth-security-delivery.ts`, `lib/notifications/auth-security-events.ts`, `lib/notifications/operational-alert-delivery.ts`, `lib/payments/customer-email.ts`, and `lib/seminars/seminars.ts`. The full raw-SQL, migration, and database-object audit is still required.

Use `node scripts/preflight-schema-isolation.mjs` from an authorized environment to produce a redacted object/dependency inventory; it does not mutate data or print member records.

## Do not cut over until these gates pass

1. Finish the full code audit and make all ORM and raw SQL schema-qualified references deployment-aware, including Drizzle migration history, database functions, triggers and sequences.
2. Create and **restore-test** a PostgreSQL backup, and verify the precise database version and available disk capacity.
3. Quiesce the two Next.js deployments and background workers; never interfere with the live WordPress site.
4. Rename `idoc` to `idoc_production` only after compatible Next.js code is ready. Copy all schema objects and complete data into `idoc_staging`, verify row counts, FK constraints, sequences, ownership and cross-schema references.
5. Quarantine staging sessions, OTP/recovery and pending outbox state; prevent test Stripe operations or Brevo notifications from reaching real users.
6. Set `DB_SCHEMA=idoc_staging` on staging Preview and `DB_SCHEMA=idoc_production` on production, redeploy and verify both environments. Keep communications/billing launch hold active.
7. Only after real isolation tests succeed, enable QStash recurring schedules on staging.

**Current state: preparation only. No schema rename, copy, environment-variable switch or QStash schedule cutover has occurred.**
