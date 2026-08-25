import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const root = new URL('../', import.meta.url);
const migrations = new URL('../lib/db/migrations/', import.meta.url);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const executeFile = promisify(execFile);

test('released migrations, snapshots, and journal entries retain their committed checksums', async () => {
  const manifest = JSON.parse(await readFile(new URL('released-checksums.json', migrations), 'utf8'));
  assert.equal(manifest.algorithm, 'sha256');

  const protectedIndexes = Array.from({ length: manifest.releasedThrough + 1 }, (_, index) => String(index).padStart(4, '0'));
  const names = await readdir(migrations);
  const protectedSql = names.filter((name) => protectedIndexes.some((index) => name.startsWith(`${index}_`)) && name.endsWith('.sql'));
  assert.equal(protectedSql.length, protectedIndexes.length, 'each released migration index must resolve to exactly one SQL file');

  for (const [path, expected] of Object.entries<string>(manifest.files)) {
    const actual = digest(await readFile(new URL(path, root)));
    assert.equal(actual, expected, `released immutable file changed: ${path}`);
  }

  const journal = JSON.parse(await readFile(new URL('meta/_journal.json', migrations), 'utf8'));
  for (const index of protectedIndexes) {
    const entry = journal.entries.find(({ idx }: { idx: number }) => String(idx).padStart(4, '0') === index);
    assert.ok(entry, `released journal entry is missing: ${index}`);
    assert.equal(digest(JSON.stringify(entry)), manifest.journalEntries[index], `released journal entry changed: ${index}`);
    assert.ok(Object.keys(manifest.files).some((path) => path.includes(`/meta/${index}_snapshot.json`)), `released snapshot is not protected: ${index}`);
    assert.ok(Object.keys(manifest.files).some((path) => path.includes(`/${index}_`) && path.endsWith('.sql')), `released migration is not protected: ${index}`);
  }
});

test('the current schema exports exactly generate the authoritative migration snapshot', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'idoc-schema-snapshot-'));
  try {
    await executeFile(process.execPath, [
      fileURLToPath(new URL('../node_modules/drizzle-kit/bin.cjs', import.meta.url)),
      'generate',
      `--schema=${fileURLToPath(new URL('../lib/db/schema.ts', import.meta.url))}`,
      `--out=${temporary}`,
      '--dialect=postgresql',
    ], { cwd: fileURLToPath(root) });

    const generated = JSON.parse(await readFile(join(temporary, 'meta', '0000_snapshot.json'), 'utf8'));
    const authoritative = JSON.parse(await readFile(new URL('meta/0019_snapshot.json', migrations), 'utf8'));
    for (const snapshot of [generated, authoritative]) {
      delete snapshot.id;
      delete snapshot.prevId;
    }
    assert.deepEqual(generated, authoritative, 'lib/db/schema.ts changed without a matching generated migration and snapshot');
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
});
