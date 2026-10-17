/**
 * Trims a MySQL dump down to the CREATE TABLE and INSERT statements of the tables the importer needs. It runs in the Super
 * Admin's browser before upload, so the rest of the dump (for example MemberPress event logs) never leaves the computer and
 * the upload stays small. Line based: phpMyAdmin and mysqldump both write one row per line with newlines escaped inside values.
 * The server still parses and validates whatever it receives, so a mistake here can only produce an error, never wrong data.
 *
 * TEMPORARY legacy-import support code: delete with the rest of lib/legacy-import once the migration is finished.
 */
export const LEGACY_TABLE_NAMES = {
  users: 'psspaceusers',
  usermeta: 'psspaceusermeta',
  transactions: 'psspace58_mepr_transactions',
  subscriptions: 'psspace58_mepr_subscriptions',
} as const;

export function reduceDumpText(text: string, tables: ReadonlySet<string>): string {
  const out: string[] = [];
  let mode: 'create' | 'insert' | null = null;
  let keeping = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd();
    if (mode === null) {
      const create = /^CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)`/.exec(line);
      const insert = create ? null : /^INSERT INTO `([^`]+)`/.exec(line);
      if (create) { mode = 'create'; keeping = tables.has(create[1]); }
      else if (insert) { mode = 'insert'; keeping = tables.has(insert[1]); }
      else continue;
      if (keeping) out.push(line);
      // A single-line INSERT ends on its own line.
      if (mode === 'insert' && trimmed.endsWith(';')) mode = null;
      continue;
    }
    if (keeping) out.push(line);
    if (mode === 'create' ? /^\)[^`]*;$/.test(trimmed) : trimmed.endsWith(';')) mode = null;
  }
  return out.length > 0 ? `${out.join('\n')}\n` : '';
}
