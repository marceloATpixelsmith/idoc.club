#!/usr/bin/env bash
set -euo pipefail
umask 077
# RESTORE CHECK: restore the verified backup archive into a throwaway PostgreSQL cluster and require every table back.
# pg_restore executes SQL taken from the archive (see the warning in the PostgreSQL pg_restore documentation), so this script runs
# in its own workflow step with NO credentials in its environment, and refuses to run if any are present.
for secret in DATABASE_BACKUP_URL IDOC_BACKUP_ENCRYPTION_PASSPHRASE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY R2_ACCOUNT_ID PGPASSWORD PGUSER PGHOST; do
  if [[ -n "${!secret:-}" ]]; then echo "::error::Restore check must run without credentials; $secret is set"; exit 1; fi
done
dir="${1:?usage: restore-check-idoc.sh INPUT_DIR}"
[[ -f "$dir/archive.dump" && -f "$dir/toc" ]] || { echo "::error::Restore check input is missing"; exit 1; }
pgbin="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
work="$(mktemp -d)"; scratch="$work/cluster"; sock="$work/sock"; mkdir -p "$sock"
cleanup() { "$pgbin/pg_ctl" -D "$scratch" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work" "$dir"; }
trap cleanup EXIT
# A scratch cluster on a unix socket only: no network listener, no credentials. Every PostgreSQL command runs with an empty environment.
pg() { env -i PATH="$PATH" HOME="$HOME" PGHOST="$sock" PGPORT=55433 PGUSER=restore_check PGDATABASE=postgres "$@"; }
env -i PATH="$PATH" HOME="$HOME" "$pgbin/initdb" -D "$scratch" -A trust -U restore_check >/dev/null
env -i PATH="$PATH" HOME="$HOME" "$pgbin/pg_ctl" -D "$scratch" -o "-p 55433 -k $sock -c listen_addresses=''" -l "$work/server.log" -w start >/dev/null
pg "$pgbin/createdb" restore_check_db
# Ownership and grants name roles that do not exist in the scratch cluster, so they are skipped; structure and data are not.
if ! pg "$pgbin/pg_restore" --no-owner --no-privileges --dbname=restore_check_db "$dir/archive.dump" 2>"$work/errors.log"; then
  echo "::error::Restore check failed: $(grep -c '^pg_restore: error:' "$work/errors.log" || true) restore error(s)"
  # Only the error summary lines are printed; detail lines can contain row values.
  grep '^pg_restore: error:' "$work/errors.log" | head -5 | cut -c1-200 || true
  exit 1
fi
summary=""
for schema in idoc_staging idoc_production; do
  expected="$(grep -cE "^[0-9]+; [0-9]+ [0-9]+ TABLE $schema " "$dir/toc" || true)"
  actual="$(pg "$pgbin/psql" -d restore_check_db -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '$schema' AND table_type = 'BASE TABLE'")"
  if [[ "$expected" -lt 1 || "$expected" != "$actual" ]]; then
    echo "::error::Restore check failed: $schema has $actual restored table(s), archive lists $expected"
    exit 1
  fi
  summary="$summary $schema=$actual"
done
# ROW-COUNT COMPARISON (when the backup carried a manifest): every table must exist with exactly the row count recorded in the same
# snapshot as the dump. Counts and table names only are printed, never row data.
status=PASS; mismatches='[]'; tables_expected=0
if [[ -f "$dir/manifest.json" ]]; then
  count_sql="$(pg "$pgbin/psql" -d restore_check_db -Atqc "SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM %I.%I', table_schema || '.' || table_name, table_schema, table_name), ' UNION ALL ') FROM information_schema.tables WHERE table_schema IN ('idoc_staging','idoc_production') AND table_type = 'BASE TABLE'")"
  pg "$pgbin/psql" -d restore_check_db -Atq -F $'\t' -c "SELECT t, n FROM ($count_sql) c ORDER BY t" > "$work/restored-counts.tsv"
  eval "$(python3 - "$dir/manifest.json" "$work/restored-counts.tsv" <<'PY'
import json, shlex, sys
expected = json.load(open(sys.argv[1]))['counts']
actual = {}
for line in open(sys.argv[2]):
    t, n = line.rstrip('\n').split('\t'); actual[t] = int(n)
bad = [{'table': t, 'expected': expected.get(t), 'actual': actual.get(t)} for t in sorted(set(expected) | set(actual)) if expected.get(t) != actual.get(t)]
print('mismatches=%s tables_expected=%d status=%s' % (shlex.quote(json.dumps(bad[:50])), len(expected), 'FAIL' if bad else 'PASS'))
PY
)"
fi
RESULT_FILE="${RESULT_FILE:-$work/restore-result.json}"
if [[ -f "$dir/manifest.json" ]]; then
  STATUS="$status" MISMATCHES="$mismatches" EXPECTED="$tables_expected" SUMMARY="$summary" python3 - "$dir" "$RESULT_FILE" <<'PY'
import json, os, sys, datetime
d, out = sys.argv[1], sys.argv[2]
manifest = json.load(open(os.path.join(d, 'manifest.json'))) if os.path.exists(os.path.join(d, 'manifest.json')) else {}
checks = json.load(open(os.path.join(d, 'checks.json'))) if os.path.exists(os.path.join(d, 'checks.json')) else {}
res = {'version': 1, 'status': os.environ['STATUS'], 'object': manifest.get('object'), 'backupStartedAtUtc': manifest.get('startedAtUtc'),
  'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
  'checksumMatched': checks.get('checksumMatched'), 'manifestTables': int(os.environ['EXPECTED']), 'schemasRestored': os.environ['SUMMARY'].split(),
  'rowCountMismatches': json.loads(os.environ['MISMATCHES'])}
if res['checksumMatched'] is False: res['status'] = 'FAIL'
json.dump(res, open(out, 'w'), separators=(',', ':'), sort_keys=True)
PY
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::notice title=idoc-restore-result::$(sed 's/%/%25/g' "$RESULT_FILE")"; fi
  grep -q '"status":"PASS"' "$RESULT_FILE" || { echo "::error::Restore verification FAILED (see the result annotation)"; exit 1; }
fi
echo "Restore check passed (tables restored:$summary; manifest row counts: $([[ -f "$dir/manifest.json" ]] && echo "$tables_expected tables compared" || echo none))"
