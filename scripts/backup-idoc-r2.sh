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
export PGDATABASE="$DATABASE_BACKUP_URL"
# FAIL CLOSED IF CREDENTIALS CAN MODIFY DATA OR READ NON-IDOC SCHEMAS.
role_check="$(psql -Atqc "SELECT CASE WHEN current_database() = 'ayni_space'
  AND current_user = 'idoc_backup_reader'
  AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
    AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
  AND NOT EXISTS (SELECT 1 FROM pg_namespace n
    WHERE n.nspname NOT IN ('idoc_staging','idoc_production')
      AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND (has_schema_privilege(current_user,n.oid,'CREATE')
           OR (has_schema_privilege(current_user,n.oid,'USAGE')
               AND EXISTS (SELECT 1 FROM pg_class t WHERE t.relnamespace=n.oid
                   AND t.relkind IN ('r','p','v','m','S')
                   AND has_table_privilege(current_user,t.oid,'SELECT')))))
  AND NOT EXISTS (SELECT 1 FROM pg_class t
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname IN ('idoc_staging','idoc_production')
      AND (has_table_privilege(current_user,t.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR has_schema_privilege(current_user,n.oid,'CREATE')))
  THEN 'ok' ELSE 'deny' END")"
[[ "$role_check" == ok ]] || { echo "::error::Backup role privileges or database identity invalid"; exit 1; }
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
echo "Verified IDOC-only backup object=$object sha256=$(sha256sum "$tmp/roundtrip.gpg" | cut -d' ' -f1)"
