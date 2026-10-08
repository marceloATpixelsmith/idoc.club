import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOTS = ['app', 'lib'];
const EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.ts', '.tsx']);
const EXCLUDED_PREFIXES = [
  path.join('lib', 'db', 'migrations'),
];

async function collectFiles(relativeDirectory: string): Promise<string[]> {
  const entries = await readdir(relativeDirectory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (EXCLUDED_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix + path.sep))) return [];
    if (entry.isDirectory()) return collectFiles(relativePath);
    return EXTENSIONS.has(path.extname(entry.name)) ? [relativePath] : [];
  }));
  return nested.flat();
}

test('runtime source never hardcodes the legacy idoc PostgreSQL schema', async () => {
  const files = (await Promise.all(ROOTS.map(collectFiles))).flat();
  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    source.split('\n').forEach((line, index) => {
      if (/\bidoc\.(?!club\b)/.test(line)) violations.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(violations, [], `Hardcoded runtime schema references found:\n${violations.join('\n')}`);
});
