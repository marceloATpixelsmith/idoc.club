# Render PostgreSQL schema separation — Next.js redesign only

The live WordPress site at `idoc.club` is out of scope and uses a separate database.

The Next.js redesign currently connects to Render PostgreSQL database `ayni_space`. The coordinated target is:

- `redesign.idoc.club` → `idoc_production`
- `staging.idoc.club` → `idoc_staging`

The existing `idoc` schema is renamed to `idoc_production`. The staging schema is restored from an independently verified copy of the same consistent backup. No database cutover is performed by merging this PR.

## Runtime isolation

`lib/db/schema-name.ts` is the single schema selector. It permits only `idoc`, `idoc_production`, and `idoc_staging`, retains `idoc` as the preparation-time default, refuses `idoc_staging` in Vercel Production, and refuses `idoc_production` in Preview deployments.

Drizzle table metadata uses the selected schema. Raw PostgreSQL SQL uses unqualified relations on a connection whose `search_path` is the validated selected schema. `tests/runtime-schema-isolation.test.ts` prevents legacy runtime table qualifiers from returning.

Historical generated migration SQL is not edited in place. `pnpm db:migrate` copies the migration folder to a temporary directory, rewrites only quoted PostgreSQL `"idoc"` schema identifiers to the validated target schema, and runs Drizzle's migrator with its migration journal in that same target schema. URLs and non-schema strings such as `idoc.club` and custom setting names remain unchanged.

## Side-effect isolation

The existing `DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING` launch hold remains fail-closed. A copied staging schema is sanitized before it can serve application traffic:

- all copied sessions are revoked and user session versions are incremented;
- email verification, account recovery, OTP, OAuth, MFA challenge/enrollment, and MFA recovery credentials are invalidated;
- remembered/trusted devices are revoked;
- unsent email/notification/operational queues are dead-lettered and leases are cleared;
- open membership and seminar Checkout attempts are expired.

Staging also refuses a live Stripe secret when `DB_SCHEMA=idoc_staging`, even if another configuration mistake were to release the general launch hold.

## Backup, restore rehearsal, cutover and rollback

The guarded operator workflow is `scripts/schema-isolation-cutover.sh`. It requires explicit confirmation values and a separate restore-verification PostgreSQL database. It has four phases:

1. `backup-and-verify` creates a custom-format `pg_dump`, restores it into the separate verification database, and compares deterministic table row counts, sequences, constraints, functions, and triggers.
2. `prepare-staging-archive` renames the restored verification copy from `idoc` to `idoc_staging` and creates a standalone staging archive.
3. `cutover` renames live `idoc` to `idoc_production`, restores the standalone staging archive, sanitizes staging operational state, and runs `scripts/validate-schema-isolation.sql`.
4. `rollback` preserves any staging copy under a rollback name and renames `idoc_production` back to `idoc`.

If the live cutover fails after the production rename, the script attempts an automatic schema-name rollback before exiting. It never drops the production schema or the staging copy.

The post-cutover validator compares relation inventories, row counts, sequence state, indexes, constraints, functions, triggers, relation owners/ACLs, staging sanitization state, and PostgreSQL catalog dependencies. Any cross-reference between `idoc_production` and `idoc_staging` fails validation. The read-only preflight script additionally inspects dependency catalogs and textual function definitions for dynamic cross-schema SQL.

## Database login isolation

The schema name alone is not the security boundary. Cutover provisions two PostgreSQL login roles with no passwords until an operator configures them through a secure PostgreSQL client:

- `idoc_production_app` receives DML access only to `idoc_production`.
- `idoc_staging_app` receives DML access only to `idoc_staging`.

The roles cannot inherit other role privileges, own neither application schema, cannot create schemas or tables, and are denied access to the opposite schema. Default grants cover future application tables and sequences. DDL migrations must use the separately authorized schema-owner connection under controlled operations, not either application login. The production and staging `POSTGRES_URL` values must use different role credentials, not the existing shared/owner credential.

The roles start without passwords by design. Set unique strong passwords in a trusted PostgreSQL GUI/client after the cutover, then configure corresponding server-only project-scoped `POSTGRES_URL` values in Vercel. Never place passwords in documentation, issue comments or this conversation.

`lib/db/connection-url.ts` refuses a production deployment using any login other than `idoc_production_app` once `DB_SCHEMA=idoc_production`, and refuses staging Preview using any login other than `idoc_staging_app` once `DB_SCHEMA=idoc_staging`. This is an additional guard; the database GRANT/REVOKE policy is the actual access boundary. Only the `staging` Git branch can select `idoc_staging` in Vercel Preview.

## Vercel activation order

Do not create or activate `DB_SCHEMA` before both target schemas exist and validation succeeds.

At the coordinated cutover, inspect both Project Environment Variables and Shared Environment Variables. `DB_SCHEMA` itself must remain server-only and project-scoped:

- Production: `DB_SCHEMA=idoc_production`
- Preview restricted to Git branch `staging`: `DB_SCHEMA=idoc_staging`

Do not give arbitrary Preview branches either target schema. After changing the environment variables, redeploy the matching environments and verify the resolved schema before allowing normal traffic.

## QStash sequencing

QStash comes after database isolation, not before it. Keep the existing QStash token/signing variables and the environment-specific callback base URLs. On staging:

1. verify a signed callback reaches the staging deployment;
2. verify the callback reports/uses `idoc_staging`;
3. register staging recurring schedules;
4. prove the replacement schedules execute successfully;
5. only then remove the obsolete staging Vercel Cron schedules.

Do not change production scheduling as part of staging verification. Production scheduling changes require a separately coordinated launch decision even though the code remains in this PR.
