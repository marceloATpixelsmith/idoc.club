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
  assert.doesNotMatch(script, /psql "\$DATABASE_BACKUP_URL"|--dbname=/);
  assert.match(script, /conn_env="\$\(python3/); // assignment so a parse failure stops the script under set -e
  assert.match(script, /eval "\$conn_env"/);
  assert.match(script, /unset DATABASE_BACKUP_URL/);
  assert.match(script, /Unsupported backup database URL option/);
});
