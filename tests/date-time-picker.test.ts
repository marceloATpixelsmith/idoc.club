import assert from 'node:assert/strict';
import test from 'node:test';

import { lastDaysRange, localMomentToUtc } from '../lib/forms/local-moment.ts';

test('a local moment becomes its UTC equivalent, and nothing is produced without a date', () => {
  const expected = new Date(2026, 9, 16, 9, 30).toISOString().slice(0, 16);
  assert.equal(localMomentToUtc('2026-10-16', '09', '30'), expected);
  assert.match(expected, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(localMomentToUtc('', '09', '30'), '');
  assert.equal(localMomentToUtc('not-a-date', '09', '30'), '');
});

test('the replay range covers today and the 29 days before it', () => {
  assert.deepEqual(lastDaysRange(29, new Date(2026, 9, 18, 15, 0)), { max: '2026-10-18', min: '2026-09-19' });
});
