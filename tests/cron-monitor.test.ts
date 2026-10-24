import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { bearerMatches, boundedInteger, fillDailyCounts, isoOrNull, maskRecipient } from '../lib/observability/cron-monitor-core.ts';

const TOKEN = 't'.repeat(32);

test('recipients are masked to the first letter and the domain', () => {
  assert.equal(maskRecipient('zangfuqi@gmail.com'), 'z***@gmail.com');
  assert.equal(maskRecipient('a@b.co'), 'a***@b.co');
  assert.equal(maskRecipient('not-an-address'), '***');
  assert.equal(maskRecipient('@nolocal.com'), '***');
  assert.equal(maskRecipient('trailing@'), '***');
  assert.equal(maskRecipient(null), null);
  assert.equal(maskRecipient(42), null);
});

test('the bearer token comparison accepts only the exact token', () => {
  assert.equal(bearerMatches(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(bearerMatches(TOKEN, TOKEN), true);
  assert.equal(bearerMatches(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(bearerMatches(`Bearer ${'u'.repeat(32)}`, TOKEN), false);
  assert.equal(bearerMatches(null, TOKEN), false);
  assert.equal(bearerMatches('', TOKEN), false);
});

test('query bounds fall back or clamp instead of trusting input', () => {
  assert.equal(boundedInteger(null, 30, 1, 30), 30);
  assert.equal(boundedInteger('7', 30, 1, 30), 7);
  assert.equal(boundedInteger('0', 30, 1, 30), 1);
  assert.equal(boundedInteger('999', 30, 1, 30), 30);
  assert.equal(boundedInteger('-5', 30, 1, 30), 30);
  assert.equal(boundedInteger('1; drop table', 30, 1, 30), 30);
});

test('daily counts cover every UTC day in the window and default missing days to zero', () => {
  const now = new Date('2026-10-24T01:30:00Z');
  const days = fillDailyCounts([{ day: '2026-10-22', renewal: 3, other: 1 }, { day: '2026-09-01', renewal: 9, other: 9 }], 3, now);
  assert.deepEqual(days, [
    { date: '2026-10-22', renewal: 3, other: 1 },
    { date: '2026-10-23', renewal: 0, other: 0 },
    { date: '2026-10-24', renewal: 0, other: 0 },
  ]);
  assert.equal(fillDailyCounts([], 30, now).length, 30);
});

test('timestamps are normalized and bad values become null', () => {
  assert.equal(isoOrNull(new Date('2026-10-02T02:38:16.068Z')), '2026-10-02T02:38:16.068Z');
  assert.equal(isoOrNull('2026-10-02T02:38:16.068Z'), '2026-10-02T02:38:16.068Z');
  assert.equal(isoOrNull(null), null);
  assert.equal(isoOrNull('nonsense'), null);
});

test('the monitor route is read-only, uses its own token, and returns no payload or full address', () => {
  const route = readFileSync('app/api/internal/cron-monitor/route.ts', 'utf8');
  const reader = readFileSync('lib/observability/cron-monitor.ts', 'utf8');
  assert.match(route, /cronMonitorTokenForServer\(\)/);
  assert.doesNotMatch(route, /cronSecretForServer/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(reader, /\b(insert|update|delete)\s+(into|from)?\s*notification_outbox/i);
  assert.match(reader, /payload->>'to' as recipient/);
  assert.doesNotMatch(reader, /select[^;`]*\bpayload\b\s*(,|from)/i);
  assert.match(reader, /maskRecipient\(row\.recipient\)/);
});
