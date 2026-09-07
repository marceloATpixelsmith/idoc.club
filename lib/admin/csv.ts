// Dependency-free, pure CSV formatting (RFC 4180) — no 'server-only' import, so it stays testable
// without a DB and reusable from anywhere.

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // A quoted cell is still executable in Excel/LibreOffice. Prefix formula-like values with an
  // apostrophe so exported member-controlled fields are always treated as text.
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.map(escapeCsvField).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCsvField(row[column])).join(','));
  return [header, ...body].join('\r\n');
}
