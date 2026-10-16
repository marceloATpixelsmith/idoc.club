/** Pure parsing/validation of the two JSON documents the backup and restore-drill workflows publish as workflow annotations
 * (the backup and restore-check scripts under scripts/). Both contain table names and counts only, never row data. Anything
 * that does not match the expected shape is rejected rather than displayed. */

export type BackupManifest = {
  object: string; startedAtUtc: string; kind: 'daily' | 'pre-migration'; sha256: string; sizeBytes: number; tableCount: number;
  totalRows: number;
};
export type DrillMismatch = { table: string; expected: number | null; actual: number | null };
export type DrillResult = {
  status: 'PASS' | 'FAIL'; object: string | null; backupStartedAtUtc: string | null; checkedAtUtc: string; checksumMatched: boolean | null;
  manifestTables: number; schemasRestored: string[]; rowCountMismatches: DrillMismatch[];
};

const OBJECT_PATTERN = /^idoc\/ayni_space\/(daily|pre-migration)\/\d{8}T\d{6}Z-[A-Za-z0-9-]+\/idoc-both-schemas\.dump\.gpg$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const safeCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseJson(message: string): unknown {
  try { return JSON.parse(message); } catch { return null; }
}

export function parseBackupManifest(message: string): BackupManifest | null {
  const value = parseJson(message);
  if (!isRecord(value) || value.version !== 1) return null;
  const { object, startedAtUtc, sha256, sizeBytes, tableCount, counts } = value;
  if (typeof object !== 'string' || !OBJECT_PATTERN.test(object)) return null;
  if (typeof startedAtUtc !== 'string' || !/^\d{8}T\d{6}Z$/.test(startedAtUtc)) return null;
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  if (!safeCount(sizeBytes) || !safeCount(tableCount)) return null;
  // The workflow annotation carries a summary with `totalRows` (GitHub truncates annotations at 4096 characters); the full form carries `counts`.
  let totalRows = 0;
  if (isRecord(counts)) {
    for (const count of Object.values(counts)) {
      if (!safeCount(count)) return null;
      totalRows += count;
    }
  } else if (safeCount(value.totalRows)) {
    totalRows = value.totalRows;
  } else {
    return null;
  }
  return { object, startedAtUtc, kind: object.includes('/pre-migration/') ? 'pre-migration' : 'daily', sha256, sizeBytes, tableCount, totalRows };
}

export function parseDrillResult(message: string): DrillResult | null {
  const value = parseJson(message);
  if (!isRecord(value) || value.version !== 1) return null;
  if (value.status !== 'PASS' && value.status !== 'FAIL') return null;
  if (typeof value.checkedAtUtc !== 'string' || !safeCount(value.manifestTables)) return null;
  if (!Array.isArray(value.schemasRestored) || !value.schemasRestored.every((item) => typeof item === 'string')) return null;
  if (!Array.isArray(value.rowCountMismatches)) return null;
  const mismatches: DrillMismatch[] = [];
  for (const item of value.rowCountMismatches.slice(0, 15)) {
    if (!isRecord(item) || typeof item.table !== 'string') return null;
    const expected = item.expected === null ? null : item.expected;
    const actual = item.actual === null ? null : item.actual;
    if ((expected !== null && !safeCount(expected)) || (actual !== null && !safeCount(actual))) return null;
    mismatches.push({ table: item.table.slice(0, 120), expected, actual });
  }
  return {
    status: value.status, object: typeof value.object === 'string' ? value.object : null,
    backupStartedAtUtc: typeof value.backupStartedAtUtc === 'string' ? value.backupStartedAtUtc : null, checkedAtUtc: value.checkedAtUtc,
    checksumMatched: typeof value.checksumMatched === 'boolean' ? value.checksumMatched : null, manifestTables: value.manifestTables,
    schemasRestored: value.schemasRestored.slice(0, 4).map((item) => String(item).slice(0, 60)), rowCountMismatches: mismatches,
  };
}

/** True only when every check passed and nothing was left unverified. A result that skipped the checksum or had any mismatch is not a pass. */
export function drillIsFullPass(result: DrillResult): boolean {
  return result.status === 'PASS' && result.checksumMatched === true && result.rowCountMismatches.length === 0 && result.manifestTables > 0;
}

/** Accepts only "latest" or a well-formed backup object key; the workflow validates it again. */
export function parseBackupSelection(value: unknown): string | null {
  if (value === 'latest') return 'latest';
  return typeof value === 'string' && OBJECT_PATTERN.test(value) ? value : null;
}
