#!/usr/bin/env bash
set -euo pipefail
umask 077
# ONE CONSISTENT TRANSACTION SNAPSHOT; ONLY TWO IDOC SCHEMAS.
: "${DATABASE_BACKUP_URL:?}"
: "${R2_ACCOUNT_ID:?}"
: "${R2_BUCKET:?}"
: "${AWS_ACCESS_KEY_ID:?}"
: "${AWS_SECRET_ACCESS_KEY:?}"
: "${IDOC_BACKUP_ENCRYPTION_PASSPHRASE:?}"
: "${BACKUP_KIND:?}"
[[ "${BACKUP_KIND}" == daily || "${BACKUP_KIND}" == pre-migration ]] || exit 2
for cmd in psql pg_dump pg_restore aws gpg sha256sum; do command -v "$cmd" >/dev/null; done
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
run="${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}"
export AWS_EC2_METADATA_DISABLED=true AWS_DEFAULT_REGION=auto PGCONNECT_TIMEOUT=20
# Recent AWS CLI v2 adds default checksums that S3-compatible stores such as R2 may reject; only send them when an operation requires them.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
# libpq does not read a connection URL from PGDATABASE, and putting the URL in a command-line argument would expose the credential in the process list.
# Split it into the standard PG* environment variables instead (environment values are not part of a process's command line).
conn_env="$(python3 - <<'PY'
import os, shlex, sys
from urllib.parse import urlparse, unquote, parse_qsl
u = urlparse(os.environ['DATABASE_BACKUP_URL'])
if u.scheme not in ('postgres', 'postgresql') or not (u.hostname and u.username and u.path.strip('/')):
    sys.exit('Backup database URL is not a complete postgres URL')
env = {'PGHOST': u.hostname, 'PGPORT': str(u.port or 5432), 'PGUSER': unquote(u.username),
       'PGPASSWORD': unquote(u.password or ''), 'PGDATABASE': unquote(u.path.lstrip('/'))}
for key, value in parse_qsl(u.query, keep_blank_values=True):
    if key != 'sslmode' or not value or 'PGSSLMODE' in env:
        sys.exit('Unsupported or empty backup database URL option: ' + key)
    env['PGSSLMODE'] = value
for key, value in env.items():
    print('export %s=%s' % (key, shlex.quote(value)))
PY
)"
eval "$conn_env"
unset DATABASE_BACKUP_URL conn_env
# FAIL CLOSED IF CREDENTIALS CAN MODIFY DATA OR READ NON-IDOC SCHEMAS.
# The role check below exempts only the pg_stat_statements monitoring views in schema public: they are SELECTable by PUBLIC by design (aggregate statistics; other roles' query text is hidden), so without the exemption the cross-application read check would always deny.
role_check="$(psql -Atqc "SELECT CASE WHEN current_database() = 'ayni_space'
  AND current_user = 'idoc_backup_reader'
  AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
    AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
  AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname <> current_user AND pg_has_role(current_user,r.oid,'MEMBER'))
  AND NOT EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname IN ('idoc_staging','idoc_production') AND t.relkind='S'
      AND has_sequence_privilege(current_user,t.oid,'USAGE,UPDATE'))
  AND NOT EXISTS (SELECT 1 FROM pg_namespace n
    WHERE n.nspname NOT IN ('idoc_staging','idoc_production')
      AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND (has_schema_privilege(current_user,n.oid,'CREATE')
           OR (has_schema_privilege(current_user,n.oid,'USAGE')
               AND EXISTS (SELECT 1 FROM pg_class t WHERE t.relnamespace=n.oid
                   AND t.relkind IN ('r','p','v','m')
                   AND NOT (n.nspname='public' AND t.relname IN ('pg_stat_statements','pg_stat_statements_info'))
                   AND has_table_privilege(current_user,t.oid,'SELECT')))))
  AND NOT EXISTS (SELECT 1 FROM pg_class t
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname IN ('idoc_staging','idoc_production')
      AND t.relkind IN ('r','p','v','m')
      AND (has_table_privilege(current_user,t.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR has_schema_privilege(current_user,n.oid,'CREATE')))
  THEN 'ok' ELSE 'deny' END")"
[[ "$role_check" == ok ]] || { echo "::error::Backup role privileges or database identity invalid"; exit 1; }
fingerprint="$(psql -Atqc "SELECT md5(coalesce(inet_server_addr()::text,'') || ':' || coalesce(inet_server_port()::text,'') || ':' || pg_postmaster_start_time()::text || ':' || current_database() || ':' || (SELECT oid::text FROM pg_database WHERE datname=current_database()))")"
[[ "$fingerprint" =~ ^[a-f0-9]{32}$ ]] || exit 1
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf 'server_fingerprint=%s\n' "$fingerprint" >> "$GITHUB_OUTPUT"; fi
# ONE pg_dump SNAPSHOT CONTAINS BOTH SCHEMAS AND RETAINS OWNER/ACL DETAILS.
# Row counts are taken inside the same snapshot as the dump (scripts/dump-idoc-with-counts.sh), so a restore can be compared exactly.
bash "$(dirname "${BASH_SOURCE[0]}")/dump-idoc-with-counts.sh" "$tmp/dump"
mv "$tmp/dump/idoc.dump" "$tmp/idoc.dump"
pg_restore --list "$tmp/idoc.dump" > "$tmp/toc"
for schema in idoc_staging idoc_production; do
  grep -q "SCHEMA - $schema " "$tmp/toc" || { echo "::error::Missing $schema in archive"; exit 1; }
done
printf '%s' "$IDOC_BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --symmetric --cipher-algo AES256 --output "$tmp/idoc.dump.gpg" "$tmp/idoc.dump"
object="idoc/ayni_space/$BACKUP_KIND/$stamp-$run/idoc-both-schemas.dump.gpg"
aws --endpoint-url "$endpoint" s3 cp "$tmp/idoc.dump.gpg" "s3://$R2_BUCKET/$object" --only-show-errors
aws --endpoint-url "$endpoint" s3 cp "s3://$R2_BUCKET/$object" "$tmp/roundtrip.gpg" --only-show-errors
cmp "$tmp/idoc.dump.gpg" "$tmp/roundtrip.gpg"
printf '%s' "$IDOC_BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --decrypt --output "$tmp/roundtrip.dump" "$tmp/roundtrip.gpg"
cmp "$tmp/idoc.dump" "$tmp/roundtrip.dump"
pg_restore --list "$tmp/roundtrip.dump" > /dev/null
# The manifest is the marker that this backup is complete and verified: it is uploaded only after the byte-for-byte round trip and decryption checks above pass, and
# the drill's "latest" and the Backups page list backups by manifest, so a failed or partial attempt is never offered.
# MANIFEST: names and row counts only (never row data). Stored encrypted next to the dump and echoed as a workflow annotation so the
# Super Admin Backups page can list backups without any R2 access.
manifest_json="$(OBJECT="$object" STAMP="$stamp" KIND="$BACKUP_KIND" SHA="$(sha256sum "$tmp/idoc.dump.gpg" | cut -d' ' -f1)" SIZE="$(stat -c %s "$tmp/idoc.dump.gpg")" python3 - "$tmp/dump/counts.tsv" <<'PY'
import json, os, sys
counts = {}
for line in open(sys.argv[1]):
    table, n = line.rstrip('\n').split('\t')
    counts[table] = int(n)
print(json.dumps({'version': 1, 'object': os.environ['OBJECT'], 'startedAtUtc': os.environ['STAMP'], 'kind': os.environ['KIND'],
  'sha256': os.environ['SHA'], 'sizeBytes': int(os.environ['SIZE']), 'tableCount': len(counts), 'counts': counts}, separators=(',', ':'), sort_keys=True))
PY
)"
printf '%s' "$manifest_json" > "$tmp/manifest.json"
printf '%s' "$IDOC_BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --symmetric --cipher-algo AES256 --output "$tmp/manifest.json.gpg" "$tmp/manifest.json"
aws --endpoint-url "$endpoint" s3 cp "$tmp/manifest.json.gpg" "s3://$R2_BUCKET/${object%idoc-both-schemas.dump.gpg}manifest.json.gpg" --only-show-errors
# OPTIONAL RESTORE CHECK (nightly workflow only): hand the verified archive to a separate workflow step that runs
# scripts/restore-check-idoc.sh with NO credentials. pg_restore executes SQL taken from the archive, so it must never run in a
# process that holds the database password, the R2 keys or the encryption passphrase.
if [[ "${IDOC_RESTORE_CHECK:-}" == true ]]; then
  : "${RESTORE_CHECK_INPUT_DIR:?}"
  mkdir -p "$RESTORE_CHECK_INPUT_DIR"; chmod 700 "$RESTORE_CHECK_INPUT_DIR"
  cp "$tmp/roundtrip.dump" "$RESTORE_CHECK_INPUT_DIR/archive.dump"
  cp "$tmp/toc" "$RESTORE_CHECK_INPUT_DIR/toc"
  cp "$tmp/manifest.json" "$RESTORE_CHECK_INPUT_DIR/manifest.json"
fi
echo "Verified IDOC-only backup object=$object sha256=$(sha256sum "$tmp/roundtrip.gpg" | cut -d' ' -f1)"
# ::notice annotation = the manifest (counts only), readable through the GitHub API by the Super Admin Backups page. % and newlines escaped per workflow-command rules.
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::notice title=idoc-backup-manifest::${manifest_json//%/%25}"; fi
