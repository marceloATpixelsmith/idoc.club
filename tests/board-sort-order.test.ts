import assert from 'node:assert/strict';
import test from 'node:test';
import { adminBoardProfileSchema } from '../lib/membership/validation.ts';

const parse = (boardSortOrder: unknown) => adminBoardProfileSchema.safeParse({ boardSortOrder, isBoardMember: false });

test('blank board display order stays null so unordered members sort last', () => {
  for (const blank of ['', ' ', null, undefined]) {
    const result = parse(blank);
    assert.ok(result.success);
    assert.equal(result.data.boardSortOrder, null);
  }
});

test('board display order accepts whole numbers 0-9999 and rejects the rest', () => {
  const zero = parse('0');
  assert.ok(zero.success);
  assert.equal(zero.data.boardSortOrder, 0);
  const seven = parse(' 7 ');
  assert.ok(seven.success);
  assert.equal(seven.data.boardSortOrder, 7);
  for (const bad of ['10000', '-1', '1.5', 'abc']) assert.equal(parse(bad).success, false, bad);
});
