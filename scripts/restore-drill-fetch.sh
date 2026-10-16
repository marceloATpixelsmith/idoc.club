#!/usr/bin/env bash
set -euo pipefail
umask 077
# RESTORE DRILL, STEP 1 (holds R2 keys and the passphrase; runs NO SQL from the archive). Downloads the chosen backup and its manifest,
# checks the encrypted file's SHA-256 against the manifest, decrypts both, and leaves the plain files for the credential-free step
# (scripts/restore-check-idoc.sh) in OUTPUT_DIR. Usage: restore-drill-fetch.sh OUTPUT_DIR   (BACKUP_SELECTION = latest | object key)
: "${R2_ACCOUNT_ID:?}" "${R2_BUCKET:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}" "${IDOC_BACKUP_ENCRYPTION_PASSPHRASE:?}"
out="${1:?usage: restore-drill-fetch.sh OUTPUT_DIR}"
selection="${BACKUP_SELECTION:-latest}"
for cmd in aws gpg sha256sum pg_restore python3; do command -v "$cmd" >/dev/null; done
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export AWS_EC2_METADATA_DISABLED=true AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
if [[ "$selection" == latest ]]; then
  # "latest" = the newest daily backup that has a manifest. The manifest is uploaded only after the backup was verified (round trip and
  # decryption), so an attempt that failed part-way is never chosen.
  manifest_key="$(aws --endpoint-url "$endpoint" s3 ls "s3://$R2_BUCKET/idoc/ayni_space/daily/" --recursive | awk '{print $4}' | grep -E '/manifest\.json\.gpg$' | sort | tail -1)"
  object="${manifest_key%manifest.json.gpg}idoc-both-schemas.dump.gpg"
  [[ -n "$manifest_key" ]] || object=""
  [[ -n "$object" ]] || { echo "::error::No daily backup found"; exit 1; }
else
  # Only an object of the expected shape, under the IDOC prefix, is accepted (no path tricks, no other bucket content).
  [[ "$selection" =~ ^idoc/ayni_space/(daily|pre-migration)/[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9-]+/idoc-both-schemas\.dump\.gpg$ ]] || { echo "::error::Invalid backup selection"; exit 1; }
  object="$selection"
fi
prefix="${object%idoc-both-schemas.dump.gpg}"
aws --endpoint-url "$endpoint" s3 cp "s3://$R2_BUCKET/$object" "$tmp/idoc.dump.gpg" --only-show-errors
if ! aws --endpoint-url "$endpoint" s3 cp "s3://$R2_BUCKET/${prefix}manifest.json.gpg" "$tmp/manifest.json.gpg" --only-show-errors 2>/dev/null; then
  echo "::error::This backup has no manifest (it predates the restore drill). Choose a newer backup."; exit 1
fi
gpg_decrypt() { printf '%s' "$IDOC_BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --decrypt --output "$2" "$1" 2>/dev/null; }
gpg_decrypt "$tmp/manifest.json.gpg" "$tmp/manifest.json" || { echo "::error::Cannot decrypt the manifest (wrong passphrase?)"; exit 1; }
actual="$(sha256sum "$tmp/idoc.dump.gpg" | cut -d' ' -f1)"
expected="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['sha256'])" "$tmp/manifest.json")"
if [[ "$actual" == "$expected" ]]; then matched=true; else matched=false; fi
echo "Downloaded object=$object sha256=$actual manifest-sha256-match=$matched"
gpg_decrypt "$tmp/idoc.dump.gpg" "$tmp/archive.dump" || { echo "::error::Cannot decrypt the backup (wrong passphrase?)"; exit 1; }
pg_restore --list "$tmp/archive.dump" > "$tmp/toc"
mkdir -p "$out"; chmod 700 "$out"
cp "$tmp/archive.dump" "$out/archive.dump"; cp "$tmp/toc" "$out/toc"; cp "$tmp/manifest.json" "$out/manifest.json"
printf '{"checksumMatched":%s}' "$matched" > "$out/checks.json"
