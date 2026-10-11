> **Backup change:** The maintenance workflow now creates and verifies a new encrypted offsite backup of both IDOC schemas before applying migration 0071. See [IDOC R2 Backup and Recovery](16-idoc-r2-backup-recovery.md). The former manually typed backup-reference field is no longer used.

# Migration 0071: controlled activation

The permanent promotion implementation was merged into `staging` in PR #430, but schema migration 0071 is not yet applied to either live IDOC schema. The **Manual Promotion Migration 0071** GitHub Actions workflow prepares a narrowly scoped, manually triggered migration. It does not run on pushes, PRs, builds, or deployments.

**Availability prerequisite:** GitHub only enables `workflow_dispatch` when the workflow definition exists on the repository's default branch (`main`). Merging this preparation PR into `staging` does not enable the Run workflow button by itself. When the team explicitly authorizes the workflow's inclusion in `main` through the normal staging-to-main promotion process, verify the GitHub Action appears, and choose the `staging` ref when dispatching. Do not deploy or promote `main` solely as an implicit side effect of this PR.

## Before dispatching

1. Configure the dedicated R2 IDOC-schema backup role, bucket, encryption passphrase and GitHub environment secrets described in [the backup runbook](16-idoc-r2-backup-recovery.md). The workflow generates and verifies a fresh encrypted offsite backup of the two IDOC schemas as its mandatory first database-related step. Download/decrypt/archive checks **do not constitute a full tested restore**; periodically restore to an isolated PostgreSQL database before trusting recovery readiness.
2. On GitHub, create two protected **Environments**: `idoc-db-staging-maintenance` and `idoc-db-production-maintenance`. Configure required reviewer approval for Production, **enable **Prevent self-reviews**, disable “Allow administrators to bypass configured protection rules”**, and restrict deployments to the `staging` branch. The workflow independently queries the GitHub environment configuration and refuses Production DDL if reviewers are absent, self-review is allowed, administrator bypass is enabled, or its token cannot read the protection settings. Make sure environment protection is supported for this repository plan.
3. Set an encrypted environment-scoped secret named `IDOC_MIGRATION_DATABASE_URL` in **each** maintenance environment. Value: schema-owner PostgreSQL connection string for database `ayni_space`, provided privately from Render. Do not reuse application credentials or store the string in git, Vercel, a workflow input, or comments. Rotate/remove this temporary owner secret after both migrations.
4. Reconcile **all** `idoc_staging.__drizzle_migrations` and `idoc_production.__drizzle_migrations` timestamps and hashes against the committed schema-rewritten SQL through 0070, then confirm `promotion_key` is absent in both schemas. **Both live ledgers currently fail this reconciliation**; no migration should be dispatched until the differences have been investigated and resolved.

## Execute (explicitly, schema by schema)

From GitHub **Actions → Manual Promotion Migration 0071 → Run workflow**, choose the `staging` branch. Select `idoc_staging` and type exactly `APPLY-0071-idoc_staging` in the confirmation field. After starting the run, the mandatory encrypted offsite backup must finish and verify before the migration is attempted. Review the successful run's **verification** output (two UUID columns with defaults, two unique constraints, two protected locking functions, one protected audit view, exactly one 0071 ledger entry), then independently verify those results with read-only database queries before proceeding.

Only after staging verification, manually dispatch a **new** run targeting `idoc_production`, with its own mandatory newly verified backup, and confirmation `APPLY-0071-idoc_production`. Production should require GitHub environment reviewer approval. This is a Production **schema migration**, not a Production application release or data promotion. It is never executed automatically.

The runner uses one transaction per selected schema, an advisory lock, the shared SQL-rewrite function, and **exact checks of every existing Drizzle migration timestamp and SHA-256 hash against the committed, schema-rewritten SQL files through 0070**. It inserts the `0071` hash/timestamp in `__drizzle_migrations` inside the same transaction and validates the new schema objects, default values, uniqueness constraints, restricted PUBLIC privileges and ledger entry before committing. Safe counts are included in the job output. The Production runner also requires staging to have the expected 0071 hash and installed functions/view/columns. Errors roll back the migration and ledger together; repeated runs are rejected.

**Known activation blocker (verified read-only in Render):** Both schemas currently have 66 ledger entries while the committed journal contains 71 through 0070, including missing/unexpected timestamps and multiple historical checksum mismatches. Migration 0071 **will refuse to run in either schema** until this history is reconciled against known applied SQL and the resulting schema. Do not change or fabricate ledger entries simply to satisfy this check. Perform a separate forensic, read-only comparison and explicitly review any proposed repairs before the live maintenance window.

## After migration

Validate the UUID column, uniqueness and helper function/view catalog in both schemas. Provision the dedicated role `idoc_data_promoter` using the grants in [the operations runbook](07-administrator-and-operations-runbook.md#database-role-provisioning), then add `DATA_PROMOTION_DATABASE_URL` and `DATA_PROMOTION_PLAN_SECRET` to **Vercel staging-branch scope only**. These are separate from the temporary GitHub migration-owner secret.

Redeploy staging, verify the Super Admin interface and perform the controlled draft News/Blog promotion acceptance tests in [the operations runbook](07-administrator-and-operations-runbook.md#migration-and-rollout). Do not perform an actual promotion until migrations, narrow role grants, secret scope, backup and acceptance procedures have been verified.

## Environment variables and secrets

| Name | Where | Value |
| --- | --- | --- |
| `IDOC_BACKUP_DATABASE_URL`, `IDOC_BACKUP_ENCRYPTION_PASSPHRASE`, `IDOC_R2_ACCOUNT_ID`, `IDOC_R2_ACCESS_KEY_ID`, `IDOC_R2_SECRET_ACCESS_KEY`, `IDOC_R2_BUCKET` | GitHub maintenance environments | Dedicated read-only IDOC backup role, GPG key, R2 credentials and bucket (full instructions in document 16) |
| `IDOC_MIGRATION_DATABASE_URL` | GitHub **environment secret**, in each protected maintenance environment (temporary) | Schema-owner connection URL to `ayni_space`; remove/rotate after completion |
| `DATA_PROMOTION_DATABASE_URL` | Vercel **staging branch only** (later step) | Connection URL for narrowly privileged `idoc_data_promoter` |
| `DATA_PROMOTION_PLAN_SECRET` | Vercel **staging branch only** (later step) | New independent random secret of at least 32 bytes |

The manually dispatched workflow **does** create a new verified encrypted R2 backup before attempting migration. It does not provision R2 buckets, database roles or secrets automatically. The migration still requires manual dispatch, approval and clean historical ledger checks. The separate one-time legacy-member transfer remains unimplemented and is not part of migration 0071.
