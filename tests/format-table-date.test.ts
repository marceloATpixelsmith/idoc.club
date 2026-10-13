import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTableDate } from '../lib/format.ts';

test('formatTableDate shows dd/mm/yyyy for calendar dates, timestamps, and Dates', () => {
  assert.equal(formatTableDate('2027-10-13'), '13/10/2027');
  assert.equal(formatTableDate('2026-10-13T19:23:50.000Z'), '13/10/2026');
  assert.equal(formatTableDate(new Date('2026-03-01T00:00:00Z')), '01/03/2026');
});

test('formatTableDate returns an empty string for missing or invalid values', () => {
  assert.equal(formatTableDate(undefined), '');
  assert.equal(formatTableDate(null), '');
  assert.equal(formatTableDate(''), '');
  assert.equal(formatTableDate('not a date'), '');
});
