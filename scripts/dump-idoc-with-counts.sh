#!/usr/bin/env bash
set -euo pipefail
umask 077
# DUMP + ROW COUNTS FROM ONE SNAPSHOT. Usage: dump-idoc-with-counts.sh OUT_DIR   (connection comes from the PG* environment)
# Opens a REPEATABLE READ, READ ONLY transaction, exports its snapshot, runs pg_dump against that same snapshot and counts every
# base table of the two IDOC schemas inside that same transaction. The counts are therefore exactly what the archive contains, so a
# later restore can be compared to them even though the live database keeps changing. Writes OUT_DIR/idoc.dump and OUT_DIR/counts.tsv
# ("schema.table<TAB>rows" per line). Row data is never printed.
out="${1:?usage: dump-idoc-with-counts.sh OUT_DIR}"
mkdir -p "$out"
fifo_dir="$(mktemp -d)"
trap 'exec 3>&- 4<&- 2>/dev/null || true; kill "${psql_pid:-}" 2>/dev/null || true; rm -rf "$fifo_dir"' EXIT
mkfifo "$fifo_dir/in" "$fifo_dir/out"
psql -qAtX -v ON_ERROR_STOP=1 <"$fifo_dir/in" >"$fifo_dir/out" &
psql_pid=$!
exec 3>"$fifo_dir/in" 4<"$fifo_dir/out"
send() { printf '%s\n' "$1" >&3; }
read_until() { # print lines until the sentinel
  local line
  while IFS= read -r line <&4; do
    [[ "$line" == "$1" ]] && return 0
    printf '%s\n' "$line"
  done
  return 1
}
send "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;"
send "SELECT 'SNAPSHOT=' || pg_export_snapshot();"
send "SELECT '--END--';"
snapshot="$(read_until '--END--' | sed -n 's/^SNAPSHOT=//p')"
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || { echo "::error::Could not export a database snapshot"; exit 1; }
pg_dump --snapshot="$snapshot" --schema=idoc_staging --schema=idoc_production --format=custom --file="$out/idoc.dump"
# Build one UNION ALL statement of exact counts for every base table, then run it inside the same transaction.
send "SELECT 'SQL=' || string_agg(format('SELECT %L AS t, count(*) AS n FROM %I.%I', table_schema || '.' || table_name, table_schema, table_name), ' UNION ALL ' ORDER BY table_schema, table_name) FROM information_schema.tables WHERE table_schema IN ('idoc_staging','idoc_production') AND table_type = 'BASE TABLE';"
send "SELECT '--END--';"
count_sql="$(read_until '--END--' | sed -n 's/^SQL=//p')"
[[ -n "$count_sql" ]] || { echo "::error::No IDOC tables found to count"; exit 1; }
send "SELECT t || E'\t' || n FROM ($count_sql) c ORDER BY t;"
send "SELECT '--END--';"
read_until '--END--' > "$out/counts.tsv"
send "COMMIT;"
send '\q'
wait "$psql_pid"
[[ -s "$out/counts.tsv" ]] || { echo "::error::Row counts are empty"; exit 1; }
