import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const migrations = new URL('../lib/db/migrations/', import.meta.url);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

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
