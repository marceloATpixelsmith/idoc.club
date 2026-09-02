import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkWhitespace } from '../scripts/check-whitespace.mjs';

// AUTH-OPERATIONS-010: proves the real production whitespace-check function -- not a description of
// what it should do -- actually detects each violation class it claims to, and does not flag clean
// files. Drives checkWhitespace() directly against real temporary files, the same function CI invokes.

function tempFile(content: string, extension = '.ts') {
  const dir = mkdtempSync(join(tmpdir(), 'whitespace-check-'));
  const path = join(dir, `fixture${extension}`);
  writeFileSync(path, content);
  return path;
}

test('flags a line with trailing spaces', () => {
  const path = tempFile('const value = 1;   \nconst other = 2;\n');
  const found = checkWhitespace([path]);
  assert.equal(found.length, 1);
  assert.match(found[0], /trailing whitespace/);
  rmSync(path, { force: true });
});

test('flags a file with no trailing newline at all', () => {
  const path = tempFile('const value = 1;');
  const found = checkWhitespace([path]);
  assert.equal(found.length, 1);
  assert.match(found[0], /missing trailing newline/);
  rmSync(path, { force: true });
});

test('flags a file with multiple trailing newlines', () => {
  const path = tempFile('const value = 1;\n\n\n');
  const found = checkWhitespace([path]);
  assert.equal(found.length, 1);
  assert.match(found[0], /multiple trailing newlines/);
  rmSync(path, { force: true });
});

test('a clean file with exactly one trailing newline and no trailing spaces passes', () => {
  const path = tempFile('const value = 1;\nconst other = 2;\n');
  assert.deepEqual(checkWhitespace([path]), []);
  rmSync(path, { force: true });
});

test('an unrecognized extension (e.g. a binary/lockfile-shaped path) is never checked', () => {
  const path = tempFile('const value = 1;   ', '.png');
  assert.deepEqual(checkWhitespace([path]), []);
  rmSync(path, { force: true });
});

test('an excluded generated-snapshot path is never checked even with a checked extension', () => {
  const found = checkWhitespace(['lib/db/migrations/meta/0000_snapshot.json']);
  assert.deepEqual(found, []);
});
