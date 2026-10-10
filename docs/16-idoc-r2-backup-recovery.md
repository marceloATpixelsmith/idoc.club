# IDOC-only R2 backup and recovery operations

This is an independent disaster-recovery supplement to Render's existing roughly three-day whole-database backups. These workflows back up **only** the `idoc_staging` and `idoc_production` schemas in the shared `ayni_space` PostgreSQL database; no other application's schema is included. Each backup contains **one transaction-consistent custom-format `pg_dump` archive holding only those two schemas**, encrypted under a private Cloudflare R2 prefix. Individual schemas can be selected when restoring from the archive.

## Workflows and activation

- `IDOC R2 Schema Backups` runs daily at 07:17 UTC and can be manually dispatched after the workflow exists on GitHub's default branch. The scheduled workflow likewise runs from the default branch. Until that branch contains the workflow, it is not active.
- `Manual Promotion Migration 0071` performs a fresh **pre-migration backup of both IDOC schemas** in the same job, verifies both offsite objects by downloading, decrypting, comparing checksums, and reading PostgreSQL archive contents; it will not execute the schema migration if any step fails. Production still requires independent GitHub Environment approval with no administrative bypass, staging must pass first, and the existing unreconciled historical Drizzle ledger differences continue to block migration.
- No routine application request or Vercel build has database backup or restore credentials.

Each backup archives both IDOC schemas using `pg_dump --schema=idoc_staging --schema=idoc_production --format=custom`, preserving PostgreSQL ownership and ACL metadata, encrypts it with GPG AES-256, uploads to a private R2 bucket over HTTPS, downloads it again, checks its bytes and decryptability, and validates the archive TOC using `pg_restore --list`. **This establishes upload integrity; it does not prove a real restore succeeds.** Before the backups are considered fully recovery-tested, run a restore into an isolated PostgreSQL database and reconcile table counts/representative data and functions.

## GitHub secrets and variable

Provide these to the `idoc-db-backups`, `idoc-db-staging-maintenance`, and `idoc-db-production-maintenance` GitHub Environments as needed; do not expose them to PRs or feature previews:

| Secret or variable | Value |
|---|---|
| Secret `IDOC_BACKUP_DATABASE_URL` | Database `ayni_space` connection string for a dedicated **read-only** backup role: `CONNECT` to database, `USAGE` on the two IDOC schemas and read access to their tables/sequences only. Name the role **`idoc_backup_reader`** (the script enforces it); prohibit any cross-app schema reads or writes. No other application schema grants and no DDL/DML grants |
| Secret `IDOC_BACKUP_ENCRYPTION_PASSPHRASE` | Newly generated strong, independent random GPG encryption passphrase; retain a separate recoverable copy outside GitHub |
| Secret `IDOC_R2_ACCOUNT_ID` | Cloudflare R2 account identifier |
| Variable `IDOC_R2_BUCKET` | Private, dedicated IDOC backup bucket name |
| Secret `IDOC_R2_ACCESS_KEY_ID` | R2 S3-compatible API token access key, restricted to the dedicated bucket |
| Secret `IDOC_R2_SECRET_ACCESS_KEY` | Matching R2 S3-compatible secret key |
| Existing secret `IDOC_MIGRATION_DATABASE_URL` | Schema-owner migration connection URL, **only** in the protected maintenance environments; never used by scheduled backups |

Provision existing objects with `GRANT USAGE ON SCHEMA idoc_staging,idoc_production TO idoc_backup_reader`, `GRANT SELECT ON ALL TABLES IN SCHEMA idoc_staging,idoc_production TO idoc_backup_reader`, and `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA idoc_staging,idoc_production TO idoc_backup_reader` from schema-owner credentials. For future tables and sequences, configure equivalent `ALTER DEFAULT PRIVILEGES FOR ROLE <actual_schema_owning_migration_role> IN SCHEMA <schema> GRANT SELECT ON TABLES ...` and `... GRANT USAGE,SELECT ON SEQUENCES ...` for **each** schema owner that creates objects. Review actual role membership and catalog privileges before activation. Never apply those grants to other app schemas.

The API token must be capable of uploading, reading back and listing only the dedicated backup bucket. Configure R2 bucket lifecycle retention for the daily prefix (for example 30 days); retain pre-migration snapshots longer per policy, with restricted deletion privileges and account-level recovery controls. R2 bucket storage and API calls may incur charges. Restrict the `idoc-db-backups` GitHub Environment deployment branches to **only `main`** (the workflow also has a main-ref guard). Configure a GitHub Actions failure notification/alert and periodically review actual successful runs. Protect R2/GitHub credentials and encryption key backups separately.

## Recovery and Super Admin

The Super Admin interface remains the operational owner for monitoring and initiating a **restore request**, not a place where an HTTP request can immediately overwrite a live database. This first implementation intentionally **does not grant the web app any R2 download or schema-restoration credentials**, and does not introduce a destructive restore action. Build the backup-history/request interface only after defining independent operator identity, request approval, audit persistence and a restricted, environment-specific restoration workflow. Before restoring, verify and recover the chosen backup into an isolated PostgreSQL instance, reconcile its contents, then separately authorize any production schema replacement during a maintenance window. Never restore into another application's schema or run a whole-instance `pg_restore`.

## Known pre-existing blocker

The migration runner fails closed on historical Drizzle journal/ledger discrepancies in both schemas; creating backups does not fix or bypass this. Reconcile the existing migration history separately before running migration 0071. No automated restoration, migration execution, R2 bucket provisioning, environment secret installation, or changes to Production data happen merely because this PR merges.
