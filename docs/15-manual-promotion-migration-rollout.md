# Migration 0071: controlled activation

The permanent promotion implementation was merged into `staging` in PR #430, but schema migration 0071 is not yet applied to either live IDOC schema. The **Manual Promotion Migration 0071** GitHub Actions workflow prepares a narrowly scoped, manually triggered migration. It does not run on pushes, PRs, builds, or deployments.

**Availability prerequisite:** GitHub only enables `workflow_dispatch` when the workflow definition exists on the repository's default branch (`main`). Merging this preparation PR into `staging` does not enable the Run workflow button by itself. When the team explicitly authorizes the workflow's inclusion in `main` through the normal staging-to-main promotion process, verify the GitHub Action appears, and choose the `staging` ref when dispatching. Do not deploy or promote `main` solely as an implicit side effect of this PR.

## Before dispatching

1. Obtain a verified, restorable backup of Render database `ayni_space`, record the backup identifier and UTC time, and independently confirm the restore procedure. The GitHub workflow checks that a reference is supplied; it **cannot verify that the backup exists or is restorable**. Do not enter a fabricated reference.
2. On GitHub, create two protected **Environments**: `idoc-db-staging-maintenance` and `idoc-db-production-maintenance`. Configure required reviewer approval for Production, **enable **Prevent self-reviews**, disable “Allow administrators to bypass configured protection rules”**, and restrict deployments to the `staging` branch. The workflow independently queries the GitHub environment configuration and refuses Production DDL if reviewers are absent, self-review is allowed, administrator bypass is enabled, or its token cannot read the protection settings. Make sure environment protection is supported for this repository plan.
3. Set an encrypted environment-scoped secret named `IDOC_MIGRATION_DATABASE_URL` in **each** maintenance environment. Value: schema-owner PostgreSQL connection string for database `ayni_space`, provided privately from Render. Do not reuse application credentials or store the string in git, Vercel, a workflow input, or comments. Rotate/remove this temporary owner secret after both migrations.
4. Reconcile **all** `idoc_staging.__drizzle_migrations` and `idoc_production.__drizzle_migrations` timestamps and hashes against the committed schema-rewritten SQL through 0070, then confirm `promotion_key` is absent in both schemas. **Both live ledgers currently fail this reconciliation**; no migration should be dispatched until the differences have been investigated and resolved.

## Execute (explicitly, schema by schema)

From GitHub **Actions → Manual Promotion Migration 0071 → Run workflow**, choose the `staging` branch. Select `idoc_staging`, provide the verified backup reference and type exactly `APPLY-0071-idoc_staging`. Review the successful run's **verification** output (two UUID columns with defaults, two unique constraints, two protected locking functions, one protected audit view, exactly one 0071 ledger entry), then independently verify those results with read-only database queries before proceeding.

Only after staging verification, manually dispatch a **new** run targeting `idoc_production`, with the same validated backup reference or a newer validated backup, and confirmation `APPLY-0071-idoc_production`. Production should require GitHub environment reviewer approval. This is a Production **schema migration**, not a Production application release or data promotion. It is never executed automatically.

The runner uses one transaction per selected schema, an advisory lock, the shared SQL-rewrite function, and **exact checks of every existing Drizzle migration timestamp and SHA-256 hash against the committed, schema-rewritten SQL files through 0070**. It inserts the `0071` hash/timestamp in `__drizzle_migrations` inside the same transaction and validates the new schema objects, default values, uniqueness constraints, restricted PUBLIC privileges and ledger entry before committing. Safe counts are included in the job output. The Production runner also requires staging to have the expected 0071 hash and installed functions/view/columns. Errors roll back the migration and ledger together; repeated runs are rejected.

**Known activation blocker (verified read-only in Render):** Both schemas currently have 66 ledger entries while the committed journal contains 71 through 0070, including missing/unexpected timestamps and multiple historical checksum mismatches. Migration 0071 **will refuse to run in either schema** until this history is reconciled against known applied SQL and the resulting schema. Do not change or fabricate ledger entries simply to satisfy this check. Perform a separate forensic, read-only comparison and explicitly review any proposed repairs before the live maintenance window.

## After migration

Validate the UUID column, uniqueness and helper function/view catalog in both schemas. Provision the dedicated role `idoc_data_promoter` using the grants in [the operations runbook](07-administrator-and-operations-runbook.md#database-role-provisioning), then add `DATA_PROMOTION_DATABASE_URL` and `DATA_PROMOTION_PLAN_SECRET` to **Vercel staging-branch scope only**. These are separate from the temporary GitHub migration-owner secret.

Redeploy staging, verify the Super Admin interface and perform the controlled draft News/Blog promotion acceptance tests in [the operations runbook](07-administrator-and-operations-runbook.md#migration-and-rollout). Do not perform an actual promotion until migrations, narrow role grants, secret scope, backup and acceptance procedures have been verified.

## Environment variables and secrets

| Name | Where | Value |
| --- | --- | --- |
| `IDOC_MIGRATION_DATABASE_URL` | GitHub **environment secret**, in each protected maintenance environment (temporary) | Schema-owner connection URL to `ayni_space`; remove/rotate after completion |
| `DATA_PROMOTION_DATABASE_URL` | Vercel **staging branch only** (later step) | Connection URL for narrowly privileged `idoc_data_promoter` |
| `DATA_PROMOTION_PLAN_SECRET` | Vercel **staging branch only** (later step) | New independent random secret of at least 32 bytes |

Neither this workflow nor this PR creates database backups, provisions database roles, creates secrets, or executes a migration on its own. Those are explicit operator actions. The separate one-time legacy-member transfer remains unimplemented and is not part of migration 0071.
