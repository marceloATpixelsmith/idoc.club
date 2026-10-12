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
