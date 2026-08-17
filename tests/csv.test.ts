import assert from 'node:assert/strict';
import test from 'node:test';
import { toCsv } from '../lib/admin/csv.ts';

test('header row matches the columns argument, in order, regardless of row key order', () => {
  const csv = toCsv([{ b: 2, a: 1 }], ['a', 'b']);
  assert.equal(csv.split('\r\n')[0], 'a,b');
  assert.equal(csv.split('\r\n')[1], '1,2');
});

test('commas in a field are quoted', () => {
  assert.equal(toCsv([{ name: 'Doe, Jane' }], ['name']), 'name\r\n"Doe, Jane"');
});

test('embedded double quotes are escaped by doubling, per RFC 4180', () => {
  assert.equal(toCsv([{ note: 'She said "hello"' }], ['note']), 'note\r\n"She said ""hello"""');
});

test('embedded newlines and CRLF trigger quoting', () => {
  assert.equal(toCsv([{ note: 'line1\nline2' }], ['note']), 'note\r\n"line1\nline2"');
  assert.equal(toCsv([{ note: 'line1\r\nline2' }], ['note']), 'note\r\n"line1\r\nline2"');
});

test('null and undefined values render as empty fields', () => {
  assert.equal(toCsv([{ a: null, b: undefined }], ['a', 'b']), 'a,b\r\n,');
});

test('Date values render as ISO strings', () => {
  const date = new Date('2026-01-15T10:00:00.000Z');
  assert.equal(toCsv([{ paidAt: date }], ['paidAt']), 'paidAt\r\n2026-01-15T10:00:00.000Z');
});

test('plain objects render as JSON rather than "[object Object]"', () => {
  assert.equal(toCsv([{ detail: { status: 'active' } }], ['detail']), 'detail\r\n"{""status"":""active""}"');
});

test('numbers and booleans render via String()', () => {
  assert.equal(toCsv([{ active: true, amountCents: 8000 }], ['amountCents', 'active']), 'amountCents,active\r\n8000,true');
});

test('multiple rows are newline-separated in order', () => {
  const csv = toCsv([{ n: 1 }, { n: 2 }, { n: 3 }], ['n']);
  assert.deepEqual(csv.split('\r\n'), ['n', '1', '2', '3']);
});

test('an empty rows array still produces just the header', () => {
  assert.equal(toCsv([], ['a', 'b']), 'a,b');
});
