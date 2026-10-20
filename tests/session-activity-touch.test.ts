import assert from 'node:assert/strict';
import test from 'node:test';
import { SESSION_ACTIVITY_TOUCH_INTERVAL_MS, sessionActivityNeedsTouch } from '../lib/auth/session-activity.ts';

const now = new Date('2026-10-20T12:00:00.000Z');

test('registry activity is touched when unknown, unparseable, or at least one interval old', () => {
  assert.equal(SESSION_ACTIVITY_TOUCH_INTERVAL_MS, 60_000);
  assert.equal(sessionActivityNeedsTouch(undefined, now), true);
  assert.equal(sessionActivityNeedsTouch(null, now), true);
  assert.equal(sessionActivityNeedsTouch('not a date', now), true);
  assert.equal(sessionActivityNeedsTouch(new Date(now.getTime() - SESSION_ACTIVITY_TOUCH_INTERVAL_MS), now), true);
  assert.equal(sessionActivityNeedsTouch(new Date(now.getTime() - 3_600_000).toISOString(), now), true);
});

test('registry activity under one interval old is not rewritten, including a clock slightly ahead', () => {
  assert.equal(sessionActivityNeedsTouch(new Date(now.getTime() - 1), now), false);
  assert.equal(sessionActivityNeedsTouch(new Date(now.getTime() - 59_999), now), false);
  assert.equal(sessionActivityNeedsTouch(new Date(now.getTime() + 5_000), now), false);
});

test('registry timestamps in the driver text form are understood', () => {
  assert.equal(sessionActivityNeedsTouch('2026-10-20 11:58:00.123+00', now), true);
  assert.equal(sessionActivityNeedsTouch('2026-10-20 11:59:30.000+00', now), false);
});

test('session reads are memoized per render and the activity write is throttled in both places that touch the registry', async () => {
  const { readFileSync } = await import('node:fs');
  const session = readFileSync('lib/auth/session.ts', 'utf8');
  const middleware = readFileSync('middleware.ts', 'utf8');
  assert.match(session, /if \(sessionActivityNeedsTouch\(record\.lastActivityAt, now\)\) await touchSession\(/);
  assert.match(middleware, /if \(sessionActivityNeedsTouch\(lastActivityAt, now\)\) \{/);
  assert.match(middleware, /Promise\.all\(\[\s*readActiveSession\(parsed\.sessionId, parsed\.user\.id\),\s*loadSessionGate\(parsed\.user\.id\),\s*\]\)/);
});
