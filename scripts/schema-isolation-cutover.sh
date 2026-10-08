#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${SCHEMA_ISOLATION_WORK_DIR:-${ROOT_DIR}/.schema-isolation}"
BACKUP_FILE="${WORK_DIR}/ayni_space-before-schema-isolation.dump"
STAGING_FILE="${WORK_DIR}/idoc_staging.dump"
SOURCE_INVENTORY="${WORK_DIR}/source-idoc.inventory"
RESTORE_INVENTORY="${WORK_DIR}/restored-idoc.inventory"

require_command()
{
    command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1" >&2; exit 1; }
}

require_value()
{
    local name="$1"
    [[ -n "${!name:-}" ]] || { echo "Required environment variable is missing: ${name}" >&2; exit 1; }
}

database_identity()
{
    psql "$1" -X -A -t -v ON_ERROR_STOP=1 -c "select current_database() || '|' || coalesce(inet_server_addr()::text,'local') || '|' || inet_server_port();"
}

for command_name in pg_dump pg_restore psql diff
do
    require_command "${command_name}"
done

mkdir -p "${WORK_DIR}"

case "${ACTION}" in
    backup-and-verify)
        require_value POSTGRES_URL
        require_value SCHEMA_ISOLATION_VERIFY_URL
        [[ "${SCHEMA_ISOLATION_CONFIRM:-}" == "VERIFY_BACKUP_RESTORE" ]] ||
            { echo "Refusing restore rehearsal without SCHEMA_ISOLATION_CONFIRM=VERIFY_BACKUP_RESTORE" >&2; exit 1; }

        source_identity="$(database_identity "${POSTGRES_URL}")"
        verify_identity="$(database_identity "${SCHEMA_ISOLATION_VERIFY_URL}")"
        [[ "${source_identity}" != "${verify_identity}" ]] ||
            { echo "Restore target resolves to the live source database; refusing." >&2; exit 1; }

        pg_dump --format=custom --no-owner --file="${BACKUP_FILE}" "${POSTGRES_URL}"
        pg_restore --list "${BACKUP_FILE}" >/dev/null

        pg_restore --clean --if-exists --no-owner --single-transaction             --dbname="${SCHEMA_ISOLATION_VERIFY_URL}" "${BACKUP_FILE}"

        psql "${POSTGRES_URL}" -X -A -t -v ON_ERROR_STOP=1             -v inventory_schema=idoc -f "${ROOT_DIR}/scripts/schema-isolation-inventory.sql" >"${SOURCE_INVENTORY}"
        psql "${SCHEMA_ISOLATION_VERIFY_URL}" -X -A -t -v ON_ERROR_STOP=1             -v inventory_schema=idoc -f "${ROOT_DIR}/scripts/schema-isolation-inventory.sql" >"${RESTORE_INVENTORY}"
        diff -u "${SOURCE_INVENTORY}" "${RESTORE_INVENTORY}"

        echo "Backup restore verified: ${BACKUP_FILE}"
        ;;

    prepare-staging-archive)
        require_value SCHEMA_ISOLATION_VERIFY_URL
        [[ "${SCHEMA_ISOLATION_CONFIRM:-}" == "PREPARE_STAGING_ARCHIVE" ]] ||
            { echo "Refusing staging archive preparation without SCHEMA_ISOLATION_CONFIRM=PREPARE_STAGING_ARCHIVE" >&2; exit 1; }
        [[ -s "${BACKUP_FILE}" && -s "${SOURCE_INVENTORY}" && -s "${RESTORE_INVENTORY}" ]] ||
            { echo "Verified backup artifacts are missing. Run backup-and-verify first." >&2; exit 1; }
        diff -q "${SOURCE_INVENTORY}" "${RESTORE_INVENTORY}" >/dev/null

        psql "${SCHEMA_ISOLATION_VERIFY_URL}" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $$
BEGIN
  IF to_regnamespace('idoc') IS NULL THEN RAISE EXCEPTION 'restored idoc schema is missing'; END IF;
  IF to_regnamespace('idoc_staging') IS NOT NULL THEN RAISE EXCEPTION 'idoc_staging already exists in restore rehearsal'; END IF;
END $$;
ALTER SCHEMA idoc RENAME TO idoc_staging;
COMMIT;
SQL
        pg_dump --format=custom --no-owner --schema=idoc_staging             --file="${STAGING_FILE}" "${SCHEMA_ISOLATION_VERIFY_URL}"
        pg_restore --list "${STAGING_FILE}" >/dev/null
        echo "Independent staging archive prepared: ${STAGING_FILE}"
        ;;

    cutover)
        require_value POSTGRES_URL
        [[ "${SCHEMA_ISOLATION_CONFIRM:-}" == "CUTOVER_IDOC_SCHEMAS" ]] ||
            { echo "Refusing live schema cutover without SCHEMA_ISOLATION_CONFIRM=CUTOVER_IDOC_SCHEMAS" >&2; exit 1; }
        [[ -s "${BACKUP_FILE}" && -s "${STAGING_FILE}" && -s "${SOURCE_INVENTORY}" && -s "${RESTORE_INVENTORY}" ]] ||
            { echo "Verified backup and staging archive artifacts are required before cutover." >&2; exit 1; }
        diff -q "${SOURCE_INVENTORY}" "${RESTORE_INVENTORY}" >/dev/null
        pg_restore --list "${BACKUP_FILE}" >/dev/null
        pg_restore --list "${STAGING_FILE}" >/dev/null

        psql "${POSTGRES_URL}" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $$
BEGIN
  IF to_regnamespace('idoc') IS NULL THEN RAISE EXCEPTION 'legacy idoc schema is missing'; END IF;
  IF to_regnamespace('idoc_production') IS NOT NULL THEN RAISE EXCEPTION 'idoc_production already exists'; END IF;
  IF to_regnamespace('idoc_staging') IS NOT NULL THEN RAISE EXCEPTION 'idoc_staging already exists'; END IF;
END $$;
ALTER SCHEMA idoc RENAME TO idoc_production;
COMMIT;
SQL

        pg_restore --no-owner --single-transaction --dbname="${POSTGRES_URL}" "${STAGING_FILE}"
        psql "${POSTGRES_URL}" -X -v ON_ERROR_STOP=1 -v confirm=SANITIZE_IDOC_STAGING             -f "${ROOT_DIR}/scripts/sanitize-staging-schema.sql"
        psql "${POSTGRES_URL}" -X -v ON_ERROR_STOP=1             -f "${ROOT_DIR}/scripts/validate-schema-isolation.sql"
        echo "Schema cutover completed and validated. Do not enable application traffic until DB_SCHEMA scopes are set."
        ;;

    rollback)
        require_value POSTGRES_URL
        [[ "${SCHEMA_ISOLATION_CONFIRM:-}" == "ROLLBACK_IDOC_SCHEMAS" ]] ||
            { echo "Refusing rollback without SCHEMA_ISOLATION_CONFIRM=ROLLBACK_IDOC_SCHEMAS" >&2; exit 1; }

        psql "${POSTGRES_URL}" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $$
BEGIN
  IF to_regnamespace('idoc') IS NOT NULL THEN RAISE EXCEPTION 'legacy idoc already exists; rollback state is ambiguous'; END IF;
  IF to_regnamespace('idoc_production') IS NULL THEN RAISE EXCEPTION 'idoc_production is missing'; END IF;
  IF to_regnamespace('idoc_staging_rollback') IS NOT NULL THEN RAISE EXCEPTION 'idoc_staging_rollback already exists'; END IF;
END $$;
DO $$
BEGIN
  IF to_regnamespace('idoc_staging') IS NOT NULL THEN
    EXECUTE 'ALTER SCHEMA idoc_staging RENAME TO idoc_staging_rollback';
  END IF;
END $$;
ALTER SCHEMA idoc_production RENAME TO idoc;
COMMIT;
SQL
        echo "Database schemas rolled back without dropping the staging copy. Revert DB_SCHEMA deployment values before restoring traffic."
        ;;

    *)
        echo "Usage: $0 {backup-and-verify|prepare-staging-archive|cutover|rollback}" >&2
        exit 2
        ;;
esac
