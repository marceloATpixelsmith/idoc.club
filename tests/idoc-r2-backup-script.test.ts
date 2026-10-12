import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync('scripts/backup-idoc-r2.sh', 'utf8');

test('the server fingerprint output ends with a real newline, not a literal backslash-n', () => {
  assert.match(script, /printf 'server_fingerprint=%s\\n' "\$fingerprint"/);
  assert.doesNotMatch(script, /server_fingerprint=%s\\\\n/);
});

test('the backup role check exempts only the public pg_stat_statements monitoring views', () => {
  assert.match(script, /NOT \(n\.nspname='public' AND t\.relname IN \('pg_stat_statements','pg_stat_statements_info'\)\)/);
  // The cross-application read check itself must remain in place for every other schema.
  assert.match(script, /n\.nspname NOT IN \('idoc_staging','idoc_production'\)/);
  assert.match(script, /has_table_privilege\(current_user,t\.oid,'SELECT'\)/);
});

test('both backup workflows read the IDOC-prefixed R2 account ID secret', () => {
  for (const file of ['.github/workflows/idoc-r2-backups.yml', '.github/workflows/manual-promotion-0071.yml']) {
    const workflow = readFileSync(file, 'utf8');
    assert.match(workflow, /R2_ACCOUNT_ID: \$\{\{ secrets\.IDOC_R2_ACCOUNT_ID \}\}/, file);
    assert.doesNotMatch(workflow, /CLOUDFLARE_R2_ACCOUNT_ID/, file);
  }
});

test('both backup workflows import the PostgreSQL signing key without a terminal', () => {
  for (const file of ['.github/workflows/idoc-r2-backups.yml', '.github/workflows/manual-promotion-0071.yml']) {
    // Without --batch --yes, gpg prompts on /dev/tty to overwrite an existing key file and the runner step fails.
    assert.match(readFileSync(file, 'utf8'), /sudo gpg --batch --yes --dearmor -o/, file);
  }
});

test('backup workflows rely on the runner AWS CLI and the script avoids R2-incompatible default checksums', () => {
  for (const file of ['.github/workflows/idoc-r2-backups.yml', '.github/workflows/manual-promotion-0071.yml']) {
    const workflow = readFileSync(file, 'utf8');
    // ubuntu-latest (Ubuntu 24.04) has no `awscli` apt package; the runner image ships AWS CLI v2.
    assert.doesNotMatch(workflow, /apt-get install[^\n]*awscli/, file);
    assert.match(workflow, /aws --version/, file);
  }
  const script = readFileSync('scripts/backup-idoc-r2.sh', 'utf8');
  assert.match(script, /AWS_REQUEST_CHECKSUM_CALCULATION=when_required/);
  assert.match(script, /AWS_RESPONSE_CHECKSUM_VALIDATION=when_required/);
});

test('the backup script splits the database URL into PG* environment variables and never passes it as an argument', () => {
  const script = readFileSync('scripts/backup-idoc-r2.sh', 'utf8');
  // libpq does not expand a connection URL from PGDATABASE (psql fell back to the local socket), and a URL argument would put the credential in the process list.
  assert.doesNotMatch(script, /export PGDATABASE=\"\$DATABASE_BACKUP_URL\"/);
  assert.doesNotMatch(script, /psql "\$DATABASE_BACKUP_URL"|--dbname="\$DATABASE_BACKUP_URL"/);
  assert.match(script, /conn_env="\$\(python3/); // assignment so a parse failure stops the script under set -e
  assert.match(script, /eval "\$conn_env"/);
  assert.match(script, /unset DATABASE_BACKUP_URL/);
  assert.match(script, /parse_qsl\(u\.query, keep_blank_values=True\)/); // blank option values must be rejected, not dropped
  assert.match(script, /Unsupported or empty backup database URL option/);
  const runbook = readFileSync('docs/16-idoc-r2-backup-recovery.md', 'utf8');
  assert.match(runbook, /Format of `IDOC_BACKUP_DATABASE_URL`/);
  assert.match(runbook, /only\*\* query option accepted is a single, non-empty `sslmode`/);
});

test('the nightly restore check runs in a separate step with no credentials and the pre-migration backup does not run it', () => {
  const nightly = readFileSync('.github/workflows/idoc-r2-backups.yml', 'utf8');
  const migration = readFileSync('.github/workflows/manual-promotion-0071.yml', 'utf8');
  assert.match(nightly, /IDOC_RESTORE_CHECK: 'true'/);
  assert.match(nightly, /apt-get install -y postgresql-17 postgresql-client-17/);
  assert.match(nightly, /create_main_cluster = false/);
  assert.doesNotMatch(migration, /IDOC_RESTORE_CHECK/); // the mandatory pre-migration backup stays fast
  // pg_restore executes SQL taken from the archive, so its step must not see any credential.
  const restoreStep = nightly.split('- name: Restore check (runs with no credentials)')[1]?.split('- name:')[0] ?? '';
  assert.match(restoreStep, /restore-check-idoc\.sh/);
  assert.doesNotMatch(restoreStep, /secrets\.|env:|vars\./);
  assert.doesNotMatch(nightly, /^env:/m); // no workflow-level environment that every step would inherit
  assert.match(nightly, /if: always\(\)\n\s+run: rm -rf/); // the handed-over archive is removed even when the check fails
  const backup = readFileSync('scripts/backup-idoc-r2.sh', 'utf8');
  assert.doesNotMatch(backup, /pg_restore" --no-owner/); // the backup process never restores
  assert.match(backup, /RESTORE_CHECK_INPUT_DIR/);
  const restore = readFileSync('scripts/restore-check-idoc.sh', 'utf8');
  for (const name of ['DATABASE_BACKUP_URL', 'IDOC_BACKUP_ENCRYPTION_PASSPHRASE', 'AWS_SECRET_ACCESS_KEY', 'PGPASSWORD']) assert.match(restore, new RegExp(name));
  assert.match(restore, /Restore check must run without credentials/);
  assert.match(restore, /env -i PATH=/); // every PostgreSQL command runs with an empty environment
  assert.match(restore, /listen_addresses=''/); // unix socket only, no network listener
  assert.match(restore, /--no-owner --no-privileges --dbname=restore_check_db/);
  assert.match(restore, /Restore check failed: \$schema has \$actual restored table/);
  // Failure output is limited to error summary lines because detail lines can contain row values.
  assert.match(restore, /grep '\^pg_restore: error:'/);
  assert.match(readFileSync('docs/16-idoc-r2-backup-recovery.md', 'utf8'), /Automated restore check/);
});
