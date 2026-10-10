#!/usr/bin/env bash
set -euo pipefail
umask 077
# ONLY IDOC SCHEMAS ARE BACKED UP. NEVER DUMP THE WHOLE SHARED DATABASE.
: "${DATABASE_BACKUP_URL:?}"
: "${R2_ACCOUNT_ID:?}"
: "${R2_BUCKET:?}"
: "${AWS_ACCESS_KEY_ID:?}"
: "${AWS_SECRET_ACCESS_KEY:?}"
: "${IDOC_BACKUP_ENCRYPTION_PASSPHRASE:?}"
: "${BACKUP_KIND:?}"
[[ "$BACKUP_KIND" == "daily" || "$BACKUP_KIND" == "pre-migration" ]] || exit 2
for command in psql pg_dump pg_restore aws gpg sha256sum; do command -v "$command" >/dev/null; done
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
run="${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}"
export AWS_EC2_METADATA_DISABLED=true AWS_DEFAULT_REGION=auto
# POSTGRESQL URL IS NEVER PLACED IN A PROCESS ARGUMENT.
export PGCONNECT_TIMEOUT=20
export PGDATABASE="$DATABASE_BACKUP_URL"
pg_target="$(psql -Atqc 'SELECT current_database()')"
[[ "$pg_target" == "ayni_space" ]] || { echo "::error::Wrong database"; exit 1; }
for schema in idoc_staging idoc_production; do
  # CUSTOM ARCHIVE IS PER-SCHEMA, INCLUDING DATA, TABLES, INDEXES AND SEQUENCES.
  pg_dump --schema="$schema" --format=custom --no-owner --no-acl --file="$tmp/$schema.dump"
  pg_restore --list "$tmp/$schema.dump" > "$tmp/$schema.toc"
  grep -q "SCHEMA.*$schema" "$tmp/$schema.toc" || { echo "::error::Missing schema in archive"; exit 1; }

  printf '%s' "$IDOC_BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
    --passphrase-fd 0 --symmetric --cipher-algo AES256 --output "$tmp/$schema.dump.gpg" "$tmp/$schema.dump"
  object="idoc/ayni_space/$BACKUP_KIND/$timestamp-$run/$schema.dump.gpg"
  aws --endpoint-url "$endpoint" s3 cp "$tmp/$schema.dump.gpg" "s3://$R2_BUCKET/$object" --only-show-errors
  aws --endpoint-url "$endpoint" s3 cp "s3://$R2_BUCKET/$object" "$tmp/roundtrip.gpg" --only-show-errors
  cmp "$tmp/$schema.dump.gpg" "$tmp/roundtrip.gpg" || { echo "::error::R2 backup differs"; exit 1; }
  printf '%s' "$IDOC_BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
    --passphrase-fd 0 --decrypt --output "$tmp/roundtrip.dump" "$tmp/roundtrip.gpg"
  cmp "$tmp/$schema.dump" "$tmp/roundtrip.dump" || exit 1
  pg_restore --list "$tmp/roundtrip.dump" > /dev/null
  echo "Verified backup schema=$schema object=$object sha256=$(sha256sum "$tmp/roundtrip.gpg" | cut -d' ' -f1)"
  rm -f "$tmp/roundtrip.gpg" "$tmp/roundtrip.dump"
done
