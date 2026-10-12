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
pg_dump --schema=idoc_staging --schema=idoc_production --format=custom --file="$tmp/idoc.dump"
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
# OPTIONAL RESTORE CHECK (nightly workflow only): restore the decrypted archive into a throwaway PostgreSQL cluster that
# lives only inside this job (unix socket, no network listener, no credentials) and require every table in both schemas back.
if [[ "${IDOC_RESTORE_CHECK:-}" == true ]]; then
  pgbin="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
  scratch="$tmp/restore-check"; sock="$tmp/sock"; mkdir -p "$sock"
  "$pgbin/initdb" -D "$scratch" -A trust -U restore_check >/dev/null
  "$pgbin/pg_ctl" -D "$scratch" -o "-p 55433 -k $sock -c listen_addresses=''" -l "$tmp/restore-server.log" -w start >/dev/null
  trap '"$pgbin/pg_ctl" -D "$scratch" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
  restore_env=(env -u PGSSLMODE PGHOST="$sock" PGPORT=55433 PGUSER=restore_check PGPASSWORD= PGDATABASE=postgres)
  "${restore_env[@]}" "$pgbin/createdb" restore_check_db
  # Ownership and grants name roles that do not exist in the scratch cluster, so they are skipped; structure and data are not.
  if ! "${restore_env[@]}" "$pgbin/pg_restore" --no-owner --no-privileges --dbname=restore_check_db "$tmp/roundtrip.dump" 2>"$tmp/restore-errors.log"; then
    echo "::error::Restore check failed: $(grep -c '^pg_restore: error:' "$tmp/restore-errors.log" || true) restore error(s)"
    # Only the error summary lines are printed; detail lines can contain row values.
    grep '^pg_restore: error:' "$tmp/restore-errors.log" | head -5 | cut -c1-200 || true
    exit 1
  fi
  restore_summary=""
  for schema in idoc_staging idoc_production; do
    expected="$(grep -cE "^[0-9]+; [0-9]+ [0-9]+ TABLE $schema " "$tmp/toc" || true)"
    actual="$("${restore_env[@]}" "$pgbin/psql" -d restore_check_db -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '$schema' AND table_type = 'BASE TABLE'")"
    if [[ "$expected" -lt 1 || "$expected" != "$actual" ]]; then
      echo "::error::Restore check failed: $schema has $actual restored table(s), archive lists $expected"
      exit 1
    fi
    restore_summary="$restore_summary $schema=$actual"
  done
  echo "Restore check passed (tables restored:$restore_summary)"
fi
echo "Verified IDOC-only backup object=$object sha256=$(sha256sum "$tmp/roundtrip.gpg" | cut -d' ' -f1)"
