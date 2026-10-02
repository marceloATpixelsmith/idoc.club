import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate, formatDateTime } from '../lib/format.ts';

test('formatDate spells out end-user calendar dates without timezone drift', () => {
  assert.equal(formatDate('2026-10-20'), 'October 20, 2026');
  assert.equal(formatDate('2026-01-03'), 'January 3, 2026');
});

test('formatDateTime always spells out the month for user-facing timestamps', () => {
  const rendered = formatDateTime('2026-10-20T18:30:00Z');
  assert.match(rendered, /October 20, 2026/);
});
