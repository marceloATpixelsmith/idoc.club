/**
 * Trims a MySQL dump down to the CREATE TABLE and INSERT statements of the tables the importer needs. It runs in the Super
 * Admin's browser before upload, so the rest of the dump (for example MemberPress event logs) never leaves the computer and
 * the upload stays small. Line based: phpMyAdmin and mysqldump both write one row per line with newlines escaped inside values.
 * The server still parses and validates whatever it receives, so a mistake here can only produce an error, never wrong data.
 *
 * TEMPORARY legacy-import support code: delete with the rest of lib/legacy-import once the migration is finished.
 */
export type LegacyTableRole = 'users' | 'usermeta' | 'transactions' | 'subscriptions';

/** Finds the tables by what they are, whatever prefix the WordPress install uses (for example `psspaceusers`, `wp_users`, `wp_2_mepr_transactions`). */
export function legacyTableRole(name: string): LegacyTableRole | null {
  if (/usermeta$/i.test(name)) return 'usermeta';
  if (/users$/i.test(name)) return 'users';
  if (/_mepr_transactions$/i.test(name)) return 'transactions';
  if (/_mepr_subscriptions$/i.test(name)) return 'subscriptions';
  return null;
}
export const isNeededLegacyTable = (name: string): boolean => legacyTableRole(name) !== null;

export function reduceDumpText(text: string, wanted: (table: string) => boolean): string {
  const out: string[] = [];
  let mode: 'create' | 'insert' | null = null;
  let keeping = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd();
    if (mode === null) {
      const create = /^CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)`/.exec(line);
      const insert = create ? null : /^INSERT INTO `([^`]+)`/.exec(line);
      if (create) { mode = 'create'; keeping = wanted(create[1]); }
      else if (insert) { mode = 'insert'; keeping = wanted(insert[1]); }
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
