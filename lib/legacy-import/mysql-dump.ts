/**
 * Reader for the INSERT statements of a MySQL/MariaDB dump (phpMyAdmin or mysqldump). It understands quoted strings with
 * backslash escapes and doubled quotes, NULL, numbers, the `_binary` prefix, and INSERTs with or without a column list.
 *
 * TEMPORARY legacy-import support code: delete with the rest of lib/legacy-import once the migration is finished.
 * Errors never include row content, only the table name, so a malformed dump cannot leak member data into logs.
 */

export type DumpRow = Record<string, string | null>;
export type ParsedDump = Map<string, DumpRow[]>;

export class DumpParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DumpParseError';
  }
}

const ESCAPES: Record<string, string> = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
const WHITESPACE = ' \t\r\n';

function createTableColumns(text: string): Map<string, string[]> {
  const columns = new Map<string, string[]>();
  for (const match of text.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\n\)/g)) {
    columns.set(match[1], [...match[2].matchAll(/^\s+`([^`]+)`/gm)].map((column) => column[1]));
  }
  return columns;
}

/** Parses every INSERT row of the requested tables (all tables when `onlyTables` is omitted). */
export function parseMysqlDump(text: string, only?: ReadonlySet<string> | ((table: string) => boolean)): ParsedDump {
  const result: ParsedDump = new Map();
  const declared = createTableColumns(text);
  const insertPattern = /INSERT INTO `([^`]+)`(?: \(([^)]*)\))? VALUES/g;
  let match: RegExpExecArray | null;
  while ((match = insertPattern.exec(text)) !== null) {
    const table = match[1];
    const wanted = !only || (typeof only === 'function' ? only(table) : only.has(table));
    const columns = match[2] ? match[2].split(',').map((column) => column.trim().replace(/^`|`$/g, '')) : declared.get(table) ?? [];
    let i = match.index + match[0].length;
    const length = text.length;
    for (;;) {
      while (i < length && (WHITESPACE.includes(text[i]) || text[i] === ',')) i++;
      if (i >= length || text[i] === ';') { i++; break; }
      if (text[i] !== '(') throw new DumpParseError(`Unexpected content in ${table}`);
      i++;
      const values: Array<string | null> = [];
      for (;;) {
        while (WHITESPACE.includes(text[i])) i++;
        if (text.startsWith('_binary', i)) {
          i += 7;
          while (text[i] === ' ' || text[i] === '\t') i++;
        }
        if (text[i] === "'") {
          i++;
          let value = '';
          for (;;) {
            const char = text[i];
            if (char === undefined) throw new DumpParseError(`Unterminated string in ${table}`);
            if (char === '\\') {
              const next = text[i + 1];
              if (next === undefined) throw new DumpParseError(`Unterminated string in ${table}`);
              value += ESCAPES[next] ?? next;
              i += 2;
            } else if (char === "'") {
              if (text[i + 1] === "'") { value += "'"; i += 2; } else { i++; break; }
            } else {
              value += char;
              i++;
            }
          }
          values.push(value);
        } else {
          let end = i;
          while (end < length && text[end] !== ',' && text[end] !== ')') end++;
          if (end >= length) throw new DumpParseError(`Unterminated row in ${table}`);
          const token = text.slice(i, end).trim();
          values.push(token.toUpperCase() === 'NULL' ? null : token);
          i = end;
        }
        while (WHITESPACE.includes(text[i])) i++;
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ')') { i++; break; }
        throw new DumpParseError(`Malformed row in ${table}`);
      }
      if (!wanted) continue;
      if (columns.length !== values.length) throw new DumpParseError(`Column count mismatch in ${table}`);
      const row: DumpRow = {};
      columns.forEach((column, index) => { row[column] = values[index]; });
      const rows = result.get(table);
      if (rows) rows.push(row); else result.set(table, [row]);
    }
    insertPattern.lastIndex = i;
  }
  return result;
}
