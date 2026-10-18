import { createHash } from 'node:crypto';

import { DumpParseError, parseMysqlDump, type ParsedDump } from './mysql-dump.ts';
import { isNeededLegacyTable } from './reduce-dump.ts';
import { planLegacyImport, resolveLegacyTables, summarizePlan, type DryRunReport, type LegacyImportPlan } from './transform.ts';

/** TEMPORARY legacy-import support code: delete with the rest of lib/legacy-import once the migration is finished. */
export const LEGACY_IMPORT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export class LegacyImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyImportInputError';
  }
}

export interface DryRunResult {
  report: DryRunReport;
  /** Server-side only: used for the Stripe comparison and never returned to the browser. */
  plan: LegacyImportPlan;
  files: Array<{ name: string; bytes: number; sha256: string }>;
}

/** The import is switched on only while it is being run: server-only, exact "true". */
export function legacyImportEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LEGACY_IMPORT_ENABLED === 'true';
}

/** Parses the uploaded dump files in memory and returns aggregate counts only. Nothing is stored, logged or written to a database. */
export function runLegacyDryRun(files: Array<{ name: string; bytes: Uint8Array }>, asOf: string): DryRunResult {
  if (files.length === 0) throw new LegacyImportInputError('Choose at least one dump file.');
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (total > LEGACY_IMPORT_MAX_TOTAL_BYTES) throw new LegacyImportInputError('The files are too large (limit 4 MB in total).');
  const merged: ParsedDump = new Map();
  try {
    for (const file of files) {
      const parsed = parseMysqlDump(new TextDecoder('utf-8').decode(file.bytes), isNeededLegacyTable);
      for (const [table, rows] of parsed) merged.set(table, [...(merged.get(table) ?? []), ...rows]);
    }
  } catch (error) {
    if (error instanceof DumpParseError) throw new LegacyImportInputError(`A file could not be read as a MySQL dump (${error.message}).`);
    throw error;
  }
  const { missing } = resolveLegacyTables(merged);
  if (missing.length > 0) {
    const names: Record<string, string> = { users: 'a users table (name ends in "users")', usermeta: 'a user-meta table (name ends in "usermeta")', transactions: 'a MemberPress transactions table (name ends in "_mepr_transactions")', subscriptions: 'a MemberPress subscriptions table (name ends in "_mepr_subscriptions")' };
    throw new LegacyImportInputError(`The files do not contain ${missing.map((role) => names[role]).join(', ')}. Choose the dump files that contain those tables.`);
  }
  const plan = planLegacyImport(merged, { asOf });
  return {
    report: summarizePlan(plan), plan,
    files: files.map((file) => ({ name: file.name, bytes: file.bytes.byteLength, sha256: createHash('sha256').update(file.bytes).digest('hex') })),
  };
}
