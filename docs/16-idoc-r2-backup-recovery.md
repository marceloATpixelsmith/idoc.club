# IDOC-only R2 backup and recovery operations

This is an independent disaster-recovery supplement to Render's existing roughly three-day whole-database backups. These workflows back up **only** the `idoc_staging` and `idoc_production` schemas in the shared `ayni_space` PostgreSQL database; no other application's schema is included. Each backup contains **one transaction-consistent custom-format `pg_dump` archive holding only those two schemas**, encrypted under a private Cloudflare R2 prefix. Individual schemas can be selected when restoring from the archive.

## Workflows and activation

- `IDOC R2 Schema Backups` runs daily at 07:17 UTC and can be manually dispatched after the workflow exists on GitHub's default branch. The scheduled workflow likewise runs from the default branch. Until that branch contains the workflow, it is not active.
- `Manual Promotion Migration 0071` performs a fresh **pre-migration backup of both IDOC schemas** in the same job, verifies both offsite objects by downloading, decrypting, comparing checksums, and reading PostgreSQL archive contents; it will not execute the schema migration if any step fails. Production still requires independent GitHub Environment approval with no administrative bypass, staging must pass first, and the existing unreconciled historical Drizzle ledger differences continue to block migration.
- No routine application request or Vercel build has database backup or restore credentials.

Each backup archives both IDOC schemas using `pg_dump --schema=idoc_staging --schema=idoc_production --format=custom`, preserving PostgreSQL ownership and ACL metadata, encrypts it with GPG AES-256, uploads to a private R2 bucket over HTTPS, downloads it again, checks its bytes and decryptability, and validates the archive TOC using `pg_restore --list`. **This establishes upload integrity; it does not prove a real restore succeeds.** Before the backups are considered fully recovery-tested, run a restore into an isolated PostgreSQL database and reconcile table counts/representative data and functions.

## GitHub secrets and variable

Provide these to the `idoc-db-backups`, `idoc-db-staging-maintenance`, and `idoc-db-production-maintenance` GitHub Environments as needed; do not expose them to PRs or feature previews. GitHub does not share environment secrets between environments, so a changed backup secret must be updated in all three. All three environments now exist (`idoc-db-staging-maintenance` is restricted to the `staging` branch and `idoc-db-production-maintenance` to the `staging` and `main` branches (`main` for `Auto-migrate Production Schema`); production-maintenance has a named required reviewer and no administrator bypass (self-review prevention is optional for a sole owner)) and each holds the five backup secrets, the `IDOC_R2_BUCKET` variable and, in the maintenance environments only, its own `IDOC_MIGRATION_DATABASE_URL`. `IDOC_R2_BUCKET` must exist only as an environment **variable**; a secret of the same name overrides it and breaks the run:

| Secret or variable | Value |
|---|---|
| Secret `IDOC_BACKUP_DATABASE_URL` | Database `ayni_space` connection URL (`postgresql://USER:PASSWORD@HOST:PORT/ayni_space`, with an optional `?sslmode=...`; see the format rules below) for a dedicated **read-only** backup role: `CONNECT` to database, `USAGE` on the two IDOC schemas and read access to their tables/sequences only. Name the role **`idoc_backup_reader`** (the script enforces it); prohibit any cross-app schema reads or writes. No other application schema grants and no DDL/DML grants |
| Secret `IDOC_BACKUP_ENCRYPTION_PASSPHRASE` | Newly generated strong, independent random GPG encryption passphrase; retain a separate recoverable copy outside GitHub |
| Secret `IDOC_R2_ACCOUNT_ID` | Cloudflare R2 account identifier |
| Variable `IDOC_R2_BUCKET` | Private, dedicated IDOC backup bucket name |
| Secret `IDOC_R2_ACCESS_KEY_ID` | R2 S3-compatible API token access key, restricted to the dedicated bucket |
| Secret `IDOC_R2_SECRET_ACCESS_KEY` | Matching R2 S3-compatible secret key |
| Existing secret `IDOC_MIGRATION_DATABASE_URL` | Schema-owner migration connection URL, **only** in the protected maintenance environments; never used by scheduled backups |

**Format of `IDOC_BACKUP_DATABASE_URL`.** The backup script parses the URL itself and hands the parts to `psql` and `pg_dump` through the standard `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`/`PGSSLMODE` environment variables, so the credential never appears in a process command line. It must be a complete `postgres://` or `postgresql://` URL with a user, host and database name; a password containing special characters (`@ : / % #` and so on) must be percent-encoded. The **only** query option accepted is a single, non-empty `sslmode` (for example `?sslmode=require`). Any other option (such as `application_name`, `channel_binding` or `options`), an empty value (`?sslmode=`), a repeated `sslmode`, or a URL that is not a complete postgres URL stops the script with a clear error before any database connection is made, in both the nightly workflow and the mandatory pre-migration backup. If the database provider adds a required option to its connection string, remove it from the secret or extend the allow-list in `scripts/backup-idoc-r2.sh` and its test in the same pull request.

The backup role check (in `scripts/backup-idoc-r2.sh`) refuses a role that can read any schema outside the two IDOC schemas. It exempts exactly one thing: the `pg_stat_statements` and `pg_stat_statements_info` views in schema `public`, which PostgreSQL makes SELECTable by PUBLIC (aggregate statistics only; other roles' query text is hidden) and which the Postgres monitoring export relies on. Without that exemption the check would always deny while the extension is installed in `public`.

Provision existing objects with `GRANT USAGE ON SCHEMA idoc_staging,idoc_production TO idoc_backup_reader`, `GRANT SELECT ON ALL TABLES IN SCHEMA idoc_staging,idoc_production TO idoc_backup_reader`, and `GRANT SELECT ON ALL SEQUENCES IN SCHEMA idoc_staging,idoc_production TO idoc_backup_reader` from schema-owner credentials. For future tables and sequences, configure equivalent `ALTER DEFAULT PRIVILEGES FOR ROLE <actual_schema_owning_migration_role> IN SCHEMA <schema> GRANT SELECT ON TABLES ...` and `... GRANT SELECT ON SEQUENCES ...` for **each** schema owner that creates objects. Review actual role membership and catalog privileges before activation. Never apply those grants to other app schemas.

The script refuses a backup account with role memberships (including memberships that would allow `SET ROLE`), table write privileges, schema creation privileges, other-application schema read access, or sequence `USAGE`/`UPDATE` privileges. The migration workflow passes a PostgreSQL server fingerprint from the backup step and refuses to migrate if the owner connection reaches a different server. A PostgreSQL server restart between these two steps also safely requires another backup.

The API token must be capable of uploading, reading back and listing only the dedicated backup bucket. Configure R2 bucket lifecycle retention for the daily prefix (for example 30 days); retain pre-migration snapshots longer per policy, with restricted deletion privileges and account-level recovery controls. R2 bucket storage and API calls may incur charges. Restrict the `idoc-db-backups` GitHub Environment deployment branches to **only `main`** (the workflow also has a main-ref guard). Configure a GitHub Actions failure notification/alert and periodically review actual successful runs. Protect R2/GitHub credentials and encryption key backups separately.

**Automated restore check (nightly workflow only).** After the backup is uploaded, downloaded, byte-compared and decrypted, the backup step (`IDOC_RESTORE_CHECK=true`) hands the verified archive to a **separate workflow step that has no credentials** (`scripts/restore-check-idoc.sh`: no secrets, no `env:` block, and the script refuses to run if any database, R2 or passphrase variable is present). That step starts a throwaway PostgreSQL cluster inside the runner (a unix socket only, no network listener, every PostgreSQL command run with an empty environment, deleted with the job), restores the archive into it with `pg_restore --no-owner --no-privileges` (ownership and grants name roles that do not exist in the scratch cluster; structure and data are restored), and requires every table listed in the archive for `idoc_staging` and `idoc_production` to be present afterwards. The separation is deliberate: `pg_restore` executes SQL taken from the archive, so it must never run in a process that holds the database password, the R2 keys or the encryption passphrase. The handed-over archive is removed by a final `if: always()` step. Any restore error, or a table-count mismatch in either schema, fails the run, and the failure email described below is the alert. A failure prints only `pg_restore: error:` summary lines, never detail lines that can contain row values. The mandatory pre-migration backup does not run the check, so it stays fast. This proves that the archive can be restored into a blank PostgreSQL server; it does not replace an operator rehearsal of the full recovery procedure below, and it does not compare row counts with the live database (the live data keeps changing while the snapshot is restored).

**Failure alert.** The owner's GitHub account setting Notifications -> System -> Actions is "on GitHub, Email (Failed workflows only)". A deliberately failed manual run on 12 October 2026 (the bucket variable was temporarily set to a nonexistent name, then restored) produced a failure email to the owner, so email delivery works for manually started runs; delivery for a scheduled run is confirmed only after the first scheduled run has failed or been checked. For scheduled runs GitHub notifies the person who last changed the workflow's `cron` line, so after any change to that line confirm in the Actions tab that the next scheduled run is delivered and visible.

## Recovery and Super Admin

The Super Admin interface remains the operational owner for monitoring and initiating a **restore request**, not a place where an HTTP request can immediately overwrite a live database. This first implementation intentionally **does not grant the web app any R2 download or schema-restoration credentials**, and does not introduce a destructive restore action. Build the backup-history/request interface only after defining independent operator identity, request approval, audit persistence and a restricted, environment-specific restoration workflow. Before restoring, verify and recover the chosen backup into an isolated PostgreSQL instance, reconcile its contents, then separately authorize any production schema replacement during a maintenance window. Never restore into another application's schema or run a whole-instance `pg_restore`.

## Restore manual (operator procedure)

Use this when data was lost or damaged and you need to get it back from an R2 backup. Do the steps in order, and do not skip the checks. Nothing in this manual is run by the web app, and no step here can be triggered from the Super Admin area.

**What has been verified and what has not.** The backup file format, the download/decrypt round trip, and the restore of the whole archive into a blank PostgreSQL 17 server with `--no-owner --no-privileges` are exercised by the nightly workflow on real data (Parts 4 to 6 use the same kinds of commands). The Mac-specific installation commands in Part 1 and the scratch-server commands in Part 6 have not been run on a Mac. Part 9, replacing live data, has **never been rehearsed**; do not use it on production until it has been rehearsed on `idoc_staging` and any corrections are written back into this document.

**Rules that always apply.**

- Never type or paste a secret (the passphrase, R2 keys, database URLs) into a chat, a ticket, a pull request, a document, or a file in the repository. Type them only into your own terminal, using the `read -rs` commands below, which do not echo them or store them in shell history.
- Work in a new empty folder outside the repository. Delete the decrypted dump when you are done (Part 11).
- Never restore into another application's schema. Never run a whole-instance restore. Only `idoc_staging` and `idoc_production` are ever involved.
- Restoring runs SQL that is inside the backup file. So the restore step (Part 6) must run in a terminal window that has no secrets in its environment.

### Part 0: Decide whether you need this

- If the damage happened in the last few days, ask whether Render's own database backups (about three days) are enough. They are a separate system with their own recovery steps in Render. Check Render's current documentation for how to recover a database, and use that route first for recent damage. The steps below are for older damage, damage in only the IDOC schemas, or when Render's backups are not available.
- Decide which schema is affected (`idoc_staging`, `idoc_production`, or both) and roughly when the data was last good. Each backup is a snapshot; changes made after it are not in it.
- If you only need a few rows or one table back, you will do Parts 1 to 8 and then recover just those rows (Part 9A). If you need a whole schema replaced, you will do Parts 1 to 8 and then Part 9B in a planned maintenance window.

### Part 1: What you need before you start

1. **A Mac terminal** (Terminal or iTerm).
2. **PostgreSQL 17 command-line tools.** The backups were made with PostgreSQL 17, so you need version 17 or newer tools. With Homebrew: `brew install postgresql@17`. Then set the folder containing the tools for this terminal session: `export PGBIN="$(brew --prefix postgresql@17)/bin"` and check `"$PGBIN/pg_restore" --version` prints 17.x.
3. **AWS command-line tool** (it is only used to talk to Cloudflare R2): `brew install awscli`, then check `aws --version`.
4. **GnuPG:** `brew install gnupg`, then check `gpg --version`.
5. **The backup passphrase** (the value of `IDOC_BACKUP_ENCRYPTION_PASSPHRASE`) from your password manager. If this is lost the backups cannot be decrypted by anyone.
6. **R2 credentials** with read access to the `idoc-backups` bucket: the R2 account ID, an access key ID and a secret access key. These are the values of `IDOC_R2_ACCOUNT_ID`, `IDOC_R2_ACCESS_KEY_ID` and `IDOC_R2_SECRET_ACCESS_KEY`. If you no longer have them, create a new API token in the Cloudflare dashboard (R2 -> Manage API tokens) with **Object Read only**, limited to the `idoc-backups` bucket, and revoke it when the recovery is finished.
7. **About 2 GB of free disk space** (check the size of the backup in Part 3 and keep at least four times that free).

### Part 2: Prepare a working folder and R2 access

Run these in the terminal. Each `read -rs` line waits for you to paste a value and press Return; nothing is shown on screen.

```
mkdir -m 700 ~/idoc-restore && cd ~/idoc-restore
read -rs "AWS_ACCESS_KEY_ID?R2 access key id: "; export AWS_ACCESS_KEY_ID
read -rs "AWS_SECRET_ACCESS_KEY?R2 secret access key: "; export AWS_SECRET_ACCESS_KEY
read -r "R2_ACCOUNT_ID?R2 account id: "
export AWS_DEFAULT_REGION=auto AWS_EC2_METADATA_DISABLED=true
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
```

(These `read` lines are for zsh, the default Mac shell. If your shell is bash, use `read -rsp "R2 access key id: " AWS_ACCESS_KEY_ID` and the same pattern.) The two checksum settings are the same ones the backup script uses; without them recent AWS CLI versions can be refused by R2.

### Part 3: Find the backup you want

List the daily backups (one folder per run, named with the UTC date and time):

```
aws --endpoint-url "$R2_ENDPOINT" s3 ls s3://idoc-backups/idoc/ayni_space/daily/ --recursive
```

Backups made just before a database migration are under `idoc/ayni_space/pre-migration/` instead. Each backup is one file named `idoc-both-schemas.dump.gpg`. The path looks like `idoc/ayni_space/daily/20261012T222425Z-38316434347-1/idoc-both-schemas.dump.gpg`: the part before the first dash is the UTC date and time the backup started (here 12 October 2026, 22:24:25 UTC), then the GitHub Actions run number and attempt.

Choose the **latest backup taken before the damage happened**. If you are unsure when the damage started, pick one clearly earlier, restore it in Part 6, and compare. Copy the full path of the file you chose into a variable (replace the path with yours):

```
OBJECT="idoc/ayni_space/daily/20261012T222425Z-38316434347-1/idoc-both-schemas.dump.gpg"
```

Every successful run prints the file's checksum in the workflow log, in a line starting `Verified IDOC-only backup object=... sha256=...`. Open that run in GitHub (Actions -> IDOC R2 Schema Backups) and keep the `sha256` value for Part 4.

### Part 4: Download and check the file

```
aws --endpoint-url "$R2_ENDPOINT" s3 cp "s3://idoc-backups/$OBJECT" idoc.dump.gpg
shasum -a 256 idoc.dump.gpg
```

The second command prints a long checksum. It must be exactly the same as the `sha256` in the workflow log for that run. If it differs, stop: the file is damaged or is not the file you think it is. Try another backup rather than continuing. (Log retention is limited; if the workflow log has expired you cannot do this comparison, and the decrypt and archive checks in Parts 5 and 6 are then your only checks.)

### Part 5: Decrypt

```
gpg --decrypt --output idoc.dump idoc.dump.gpg
```

A window or prompt asks for the passphrase. Enter the backup passphrase from your password manager. Success looks like `gpg: AES256.CFB encrypted data` and `gpg: encrypted with 1 passphrase`. If it says the passphrase is wrong, you used the wrong passphrase, or the file was encrypted with an older one. Try the previous passphrase if the passphrase was ever changed.

### Part 6: Check the archive, then restore it into a throwaway database

First, read the archive's contents list (this changes nothing):

```
"$PGBIN/pg_restore" --list idoc.dump | grep -E "SCHEMA - (idoc_staging|idoc_production) "
"$PGBIN/pg_restore" --list idoc.dump | grep -c " TABLE idoc_production "
"$PGBIN/pg_restore" --list idoc.dump | grep -c " TABLE idoc_staging "
```

You should see both schema lines, and each table count should be close to 55 (the number restored on 12 October 2026; it grows as migrations add tables).

**Now open a new terminal window. This window must not contain any secrets**: do not run Part 2 in it. The restore runs SQL taken from the backup file, so keep it away from your R2 keys and passphrase. Then:

```
cd ~/idoc-restore
export PGBIN="$(brew --prefix postgresql@17)/bin"
mkdir -m 700 scratch-data scratch-sock
"$PGBIN/initdb" -D scratch-data -U restore_check --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D scratch-data -l scratch.log -o "-c listen_addresses='' -c unix_socket_directories=$PWD/scratch-sock -p 55433" start
export PGHOST="$PWD/scratch-sock" PGPORT=55433 PGUSER=restore_check
"$PGBIN/createdb" restore_check_db
"$PGBIN/pg_restore" --no-owner --no-privileges --dbname=restore_check_db idoc.dump
```

This starts a temporary PostgreSQL server on your Mac that listens only on a local socket file (no network port), restores the archive into it, and has nothing to do with Render. The `--no-owner --no-privileges` flags are needed because the archive names database roles that do not exist in the scratch server. If the unix socket path is too long, move the folder to a shorter path such as `/tmp/idoc-restore` (the operating system limits socket paths to about 100 characters). To restore only one schema, add `--schema=idoc_production` (or `--schema=idoc_staging`) to the last command.

It should finish with no `pg_restore: error:` lines. A few warnings about roles or grants are not a problem; any error about a table or data is. If you see errors, stop and keep the output (without pasting row data anywhere public).

### Part 7: Look at the restored data

```
"$PGBIN/psql" -d restore_check_db -c "SELECT table_schema, count(*) FROM information_schema.tables WHERE table_schema IN ('idoc_staging','idoc_production') AND table_type='BASE TABLE' GROUP BY 1 ORDER BY 1;"
```

Both schemas should list a table count matching Part 6. Then check the data you care about, for example (the table and column names must be adapted to the real ones; check them in the schema documentation first):

```
"$PGBIN/psql" -d restore_check_db -c "SELECT count(*) FROM idoc_production.members;"
"$PGBIN/psql" -d restore_check_db -c "SELECT max(created_at) FROM idoc_production.members;"
```

The newest `created_at` should be close to the backup time in Part 3, not later.

### Part 8: Compare with the live database (read-only)

Using Beekeeper Studio (or `psql`) connected to the live Render database with the **read-only backup login (`idoc_backup_reader`)** run the same count and `max(created_at)` queries on the live schema. Differences you should expect: rows created or changed after the backup time. Differences that signal the data you want is missing: fewer rows in the backup than you expect, or a table missing from the backup. Write down, for each table you care about, the live count, the backup count and the difference.

Do not use the schema-owner login (`IDOC_MIGRATION_DATABASE_URL`) for this comparison. Do not connect the web app, a feature preview, or any other tool to the scratch server.

### Part 9: Putting data back

Choose A or B. Neither is automatic.

**9A. Recover a few rows or one table (the usual case).**

First name the schema you are recovering into, in the terminal you will use, and read it back before running anything: `read -r TARGET_SCHEMA` then type exactly `idoc_staging` or `idoc_production`, and `echo "Target schema: $TARGET_SCHEMA"`. Every command below uses `$TARGET_SCHEMA`; never retype the schema name by hand. The two schemas live in the same database, so a wrong schema name changes the wrong environment.

1. From the scratch database, export only what you need as plain SQL, for example: `"$PGBIN/pg_dump" -d restore_check_db --data-only --column-inserts --table="$TARGET_SCHEMA".<table> > recovered-<table>.sql`.
2. Read the file. Remove everything you do not intend to put back. Check that it contains no rows for other people that would overwrite newer data.
3. Ask a second person to review the SQL before it is run.
4. Run it against the live database, inside one transaction (`BEGIN; ... COMMIT;`), using a login that has write access to that schema, and only after taking a fresh backup (run the **IDOC R2 Schema Backups** workflow from GitHub Actions and wait for it to pass).
5. Look at the result, then `COMMIT` or `ROLLBACK`.

**9B. Replace a whole schema (a planned maintenance window).**

**Rehearsed on `idoc_staging` on 2026-10-16** (backup `20261016T171640Z`, run from a GitHub Codespace): it worked, and the corrections it required are folded into the steps below (create the empty schema first, re-grant schema `USAGE`, and revoke the backup login from the kept copy). Production uses the same steps with `idoc_production`. IDOC has one operator, so no second approver is required; the safeguards are the typed target confirmation, the single-transaction restore and the kept, renamed copy. **Warning:** the schema-owner login (`dbuser`, which acts as the role `ameyalli`) owns **every** schema in `ayni_space`, including other applications' schemas, so never type a schema name by hand and never run a restore command without `--schema="$TARGET_SCHEMA"`. The commands use a variable so that the same steps serve both schemas, and you must confirm it before the rename and the restore:

```
read -r TARGET_SCHEMA            # type exactly: idoc_staging   (rehearsal)   or   idoc_production
case "$TARGET_SCHEMA" in idoc_staging|idoc_production) ;; *) echo "Not a valid target"; return 1 2>/dev/null || exit 1 ;; esac
STAMP=$(date -u +%Y%m%d)
echo "About to replace schema: $TARGET_SCHEMA (the old copy will be kept as ${TARGET_SCHEMA}_replaced_${STAMP})"
printf "Type the schema name again to confirm: "; read -r CONFIRM; [ "$CONFIRM" = "$TARGET_SCHEMA" ] || { echo "Not confirmed"; return 1 2>/dev/null || exit 1; }
```

The backup holds **both** schemas, so the restore command must always name the one schema you are replacing. If the schema-owner login can change both schemas, a wrong name here changes the wrong environment; rehearse on `idoc_staging` and read the variable back before every step.

1. Decide who approves and who runs it. Record the backup object path from Part 3, the reason, and the time.
2. Take a fresh backup (run **IDOC R2 Schema Backups**, wait for it to pass), so the current damaged state is also recoverable.
3. Stop writes to that schema. No application switch for this is documented, so decide how to do it for that window (for example, accept downtime on staging; for production, a maintenance announcement and a plan agreed with the second person).
**Set up the live-database window before step 4 (and use it for steps 4 to 7).** The scratch window from Part 6 has `PGHOST`, `PGPORT` and `PGUSER` pointing at the scratch server on your Mac, and a newly opened terminal window inherits none of the variables or the folder from Parts 1 and 2. Open a **new** terminal window and run all of this in it, before anything that changes the live database (including the rename in step 4), so the rename and the restore both work and a recovery rename is possible:

```
cd ~/idoc-restore
export PGBIN="$(brew --prefix postgresql@17)/bin"
export PGHOST=<owner login host> PGPORT=<port> PGUSER=<owner login user> PGDATABASE=ayni_space
read -rs "PGPASSWORD?Schema-owner password: "; export PGPASSWORD
read -r TARGET_SCHEMA            # type exactly: idoc_staging   or   idoc_production
case "$TARGET_SCHEMA" in idoc_staging|idoc_production) ;; *) echo "Not a valid target"; return 1 2>/dev/null || exit 1 ;; esac
STAMP=$(date -u +%Y%m%d)
printf "Type the schema name again to confirm: "; read -r CONFIRM; [ "$CONFIRM" = "$TARGET_SCHEMA" ] || { echo "Not confirmed"; return 1 2>/dev/null || exit 1; }
"$PGBIN/psql" -c "select current_user, current_database()"   # must show the owner login and ayni_space, not restore_check
ls idoc.dump                                                   # the decrypted archive from Part 5 must be here
```

(The `read -rs "VAR?prompt"` form is for zsh, the Mac default; in bash use `read -rsp "prompt: " PGPASSWORD`. Get the host, port and user from the schema-owner connection string in your password manager or Render, without pasting the string into any command.) If the `psql` check shows `restore_check`, or `ls` cannot find `idoc.dump`, stop and fix the window before going on.

4. Using the schema-owner login (`IDOC_MIGRATION_DATABASE_URL`), keep the damaged schema rather than dropping it. A shell variable is not expanded inside `psql`, so pass the two confirmed names to `psql` as variables and refer to them with `:"name"` (which quotes them as identifiers). Connect with the owner login's `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` variables set in this terminal (never as a URL on the command line), then run:

   ```
   "$PGBIN/psql" -v ON_ERROR_STOP=1 -v target="$TARGET_SCHEMA" -v old="${TARGET_SCHEMA}_replaced_${STAMP}" <<'SQL'
   \echo Renaming :"target" to :"old"
   ALTER SCHEMA :"target" RENAME TO :"old";
   SQL
   ```

   The `\echo` line only records in your terminal which names were used (they were already confirmed above, before this command); check it afterwards, and never retype the names from memory.
4a. **Create the empty schema and re-grant its permissions.** `pg_restore --schema` restores the objects inside a schema but **not** the `CREATE SCHEMA` itself (the first attempt failed with `schema "idoc_staging" does not exist`) and not the schema-level grants. Before the restore, read the kept copy's grants with `select nspacl from pg_namespace where nspname = '<old>'`, then run `CREATE SCHEMA :"target";` and `GRANT USAGE ON SCHEMA :"target" TO <the same roles>;` (for staging: `ai_debugger, idoc_staging_app, idoc_backup_reader`; for production: `ai_debugger, idoc_production_app, idoc_backup_reader`).
5. Restore the chosen schema from the archive into the live database **as one transaction**, so that either all of it is applied or none of it is: `pg_restore --single-transaction --exit-on-error --no-owner --dbname=<live database> --schema="$TARGET_SCHEMA" idoc.dump`, connected as the schema-owner login (add `--no-privileges` only if the grants in the archive cannot be applied; if it is used, the grants must be re-applied from the operations runbook, section "Database role provisioning"). Run this in the live-database window you set up before step 4. Without `--single-transaction --exit-on-error`, `pg_restore` carries on after an SQL error and can leave a half-built schema in place after the original has been renamed away. **If this command reports any error, nothing has been applied: put the original back with the same `psql` pattern as step 4 (`ALTER SCHEMA :"old" RENAME TO :"target";`, with `old` and `target` set the same way), confirm the application works, and stop.** Unverified points to check on staging: whether Render's schema-owner login can apply the archive's ownership and grants, whether functions and views that mention the schema by name still work after the rename, and whether sequence values are correct.

6. Verify (row counts, newest rows, that the application works on the affected environment, and that `idoc_backup_reader` can still read the schema). Run **IDOC R2 Schema Backups** again; the role check in the script will fail if the grants are wrong.
6a. **Remove the backup login from the kept copy:** `REVOKE USAGE ON SCHEMA <old> FROM idoc_backup_reader;`. The backup script's role check refuses to run if `idoc_backup_reader` can read any schema other than the two IDOC schemas, so the renamed copy makes **IDOC R2 Schema Backups** fail closed until this is done (found in the rehearsal).
7. Keep `${TARGET_SCHEMA}_replaced_${STAMP}` for at least a week after you are satisfied, then drop it once you have confirmed nothing in it is still needed.

### Part 10: What to do if something fails

- **Wrong passphrase:** try your earlier passphrase. If none work, those backups cannot be recovered; use an older or newer one that was made with a passphrase you still have.
- **Checksum does not match:** do not use the file. Try the neighbouring backup.
- **`pg_restore: error:` lines:** do not continue to Part 9. Try the previous backup and compare. Report the error text (without row data) to whoever maintains these workflows.
- **R2 access denied:** the token is wrong or lacks read access to `idoc-backups`. Create a new read-only token as in Part 1.

### Part 11: Clean up (always)

In the scratch window: `"$PGBIN/pg_ctl" -D scratch-data stop`, then close the window. In your main window: `cd ~ && rm -rf ~/idoc-restore` (this removes the encrypted file, the decrypted dump and the scratch database), and `unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY R2_ACCOUNT_ID`. If you did Part 9, also clear the database credentials in **every** window you used for it, then close those windows: `unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE TARGET_SCHEMA STAMP CONFIRM`. If you created a temporary R2 read token for this, revoke it in Cloudflare. Record in `docs/observability-implementation-status.md` (or the operations log) which backup was used, who approved it, and the outcome.

## Super Admin backup and restore-drill tool

**Scope of the first release.** A Super Admin page at `/admin/operations/backups` that (1) shows backup history and health, (2) starts an **on-demand backup** (the same workflow as the nightly run, dispatched on `main`; audited, step-up protected, refused while one is queued or running), (3) runs a **restore drill**, and (4) provides a **maintenance-mode switch**. Replacing a live schema from the web app is **not** in this release; it stays the operator procedure in Part 9 until the drill has been proven repeatedly.

**One-person operation.** IDOC has a single operator, so no second approver is required. The controls are instead: Super Admin role, fresh privileged TOTP step-up for every action, an explicit confirmation, an immutable audit row, and the existing GitHub environment protections.

**Credential boundary (unchanged).** The web app never holds R2 keys, the backup passphrase, a database owner login or a restore login. It holds one new server-only secret, `GITHUB_BACKUP_TOOL_TOKEN`: a fine-grained GitHub token limited to this repository with only *Actions: read and write*, used to start the backup, restore-drill, staging-migration and live-auth workflows and read their results. Set it only on the deployments that show the page, never `NEXT_PUBLIC_`, and rotate it before its expiry.

**How a drill works.**
1. The Super Admin presses *Run restore drill* (choose the latest backup or a listed one), passes TOTP, confirms. The app records an audit row and dispatches the `IDOC Restore Drill` workflow on `main`.
2. The workflow runs in the `idoc-db-backups` environment, downloads the chosen object from R2, verifies its SHA-256 against the manifest written when it was backed up, decrypts it, and hands it to a separate credential-free step.
3. That step restores it into a throwaway PostgreSQL cluster (same isolation as the nightly check), counts the rows of every table in both schemas, and compares them with the **row counts captured in the same snapshot as the dump** (the manifest). It writes a small JSON result (`restore-drill-result`) and a job summary.
4. The page reads that result through the GitHub API and shows PASS or FAIL with: backup object and time, checksum match, tables expected/restored, per-table row-count comparison, who started it, when, and a link to the workflow run. PASS requires every check to pass; anything else is FAIL.

**Backup manifest.** The backup script is extended to record, inside the same snapshot as `pg_dump`, the per-table row counts for both schemas and to upload `manifest.json` (object path, sha256, size, started/finished time, counts) next to the dump. The manifest holds counts and names only, never row data.

**Maintenance mode.** A per-environment switch (stored in the environment's own schema, so staging and production are independent). While on, every visitor except a signed-in Super Admin sees a branded, large-text "We'll be right back" page with HTTP 503 and `Retry-After`; the Stripe webhook and scheduled/queue endpoints also answer 503 so providers retry later instead of writing. `/api/health` and static assets stay available. Turning it on or off requires fresh TOTP and writes an audit row. The flag is read with a short (about 3 second) in-memory cache; if it cannot be read the site stays up rather than locking everyone out.

**One-time setup.**
1. Merge the pull request that adds the tool, then run **IDOC R2 Schema Backups** once from the Actions tab (on `main`) so a backup with a manifest exists. Older backups have no manifest and cannot be drilled.
2. Create a GitHub fine-grained personal access token: resource owner = the repository owner, repository access = **only** `idoc.club`, permissions = **Actions: Read and write** only (Metadata read is added automatically; fine-grained tokens have no Checks permission, and the repository is public so workflow annotations are readable), expiry = at most 1 year (put the expiry in your calendar). Store it only in Vercel.
3. In Vercel add `GITHUB_BACKUP_TOOL_TOKEN` (Sensitive, server-only) for **Production** and for **Preview scoped to the `staging` branch**; redeploy. Optional `GITHUB_BACKUP_TOOL_REPOSITORY` (default `marceloATpixelsmith/idoc.club`).
4. Migration `0074_maintenance_mode` must be applied (staging applies itself; Production uses the reviewer-approved workflow).

**Caching.** To keep the page fast, the application keeps GitHub's run lists for 30 seconds per server instance (starting a backup or a restore drill clears them at once) and keeps a finished run's manifest or result for the life of the instance. A run that has just finished can therefore take up to 30 seconds to appear; reload the page after that.

**Reading a result.** The Backups page shows **PASS** only when the workflow finished, the downloaded file's SHA-256 matched the manifest, every manifest table was restored, and every table's restored row count equalled the count recorded in the same snapshot as the dump. Anything else is **FAIL** with the reason, and the "workflow log" link opens the GitHub run. The same result is the `idoc-restore-result` annotation on the run, and each request is recorded in the audit log (`admin.restore_drill.requested`).

**Not in this release:** live schema restore from the web app, backup deletion, and any R2 access from the application.


## Super Admin Manual GitHub Operations

The Super Admin **Manual GitHub Operations** page is directly below **Backups & restore**. It can dispatch only `Auto-migrate Staging Schema` and `Live authentication staging suite`, always against `staging`. The action requires fresh TOTP, CSRF validation, server-side Super Admin authorization, an audit entry, and duplicate-run protection. It reuses the existing `GITHUB_BACKUP_TOOL_TOKEN`; do not create another token or expose it to client code. The token's repository scope and Actions read/write permission remain as specified above.

GitHub accepts `workflow_dispatch` only after the workflow file is present on the repository's default branch (`main`). `auto-migrate-staging.yml` is already on `main`; `live-auth-staging.yml` must reach `main` through the normal reviewed staging promotion before the page can dispatch it. The `ref` passed to both workflows remains `staging`, so the migration target is `idoc_staging` and the live suite tests `staging.idoc.club`. Recent run links appear on the page; the live-auth matrix, screenshots, video and trace are in the run's `live-auth-staging-results` artifact.

## Known pre-existing blocker

The migration runner fails closed on historical Drizzle journal/ledger discrepancies in both schemas; creating backups does not fix or bypass this. Reconcile the existing migration history separately before running migration 0071. No automated restoration, migration execution, R2 bucket provisioning, environment secret installation, or changes to Production data happen merely because this PR merges.
