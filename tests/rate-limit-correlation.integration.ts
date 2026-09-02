import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { checkRateLimit } from '../lib/security/rate-limit.ts';
import { closeHarness, resetIdoc, sql } from './postgres-harness.ts';

// AUTH-OPERATIONS-006: repeated rate-limit exceedances of the same bucket across multiple windows
// must be correlated into a single operator alert, not left as N silent individually-rejected
// requests. Drives the real production checkRateLimit function -- not a parallel helper -- across
// several genuinely distinct 15-minute windows to reproduce the actual sustained-blocking shape this
// control targets, and proves both the positive case (alert fires once the threshold is crossed) and
// that an isolated, one-off block (a single busy window) never fires it.

const WINDOW_MS = 15 * 60 * 1000;

Object.assign(process.env, {
  AUTH_SECRET: 'rate-limit-correlation-test-secret-long-enough',
  IDOC_ADMIN_NOTIFICATION_EMAIL: 'ops@example.test',
  MAILCHIMP_TRANSACTIONAL_API_KEY: 'integration-only-provider-key-32-chars-plus',
  RATE_LIMIT_HASH_KEY: 'rate-limit-correlation-test-secret-long-enough',
});

const originalFetch = globalThis.fetch;
let sentAlerts: { subject: string; to: string }[] = [];
let failNextDelivery = false;
beforeEach(async () => {
  await resetIdoc();
  sentAlerts = [];
  failNextDelivery = false;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://mandrillapp.com/api/1.0/messages/send.json') {
      if (failNextDelivery) { failNextDelivery = false; return new Response('provider unavailable', { status: 502 }); }
      const body = JSON.parse(String(init?.body));
      sentAlerts.push({ subject: body.message.subject, to: body.message.to[0].email });
      return new Response('[{"status":"sent"}]', { status: 200 });
    }
    return originalFetch(input, init);
  };
});
after(async () => { globalThis.fetch = originalFetch; await closeHarness(); });

async function exhaustEmailBucketOnce(purpose: string, email: string, origin: string, windowNow: Date) {
  let lastAllowed = true;
  for (let i = 0; i < 4; i += 1) lastAllowed = await checkRateLimit(purpose, email, origin, windowNow);
  return lastAllowed;
}

test('an account blocked by the same rate limit in 3 of the last 4 windows triggers one operator alert', async () => {
  const purpose = 'test_sustained_purpose';
  const email = 'attacker@example.test';
  const origin = '203.0.113.5';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);

  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    const windowNow = new Date(base + windowIndex * WINDOW_MS + 1_000);
    const allowed = await exhaustEmailBucketOnce(purpose, email, origin, windowNow);
    assert.equal(allowed, false, 'the 4th request within a 3-request window must already be denied');
  }

  assert.equal(sentAlerts.length, 1, 'the sustained pattern across 3 windows must trigger exactly one alert');
  assert.equal(sentAlerts[0].to, 'ops@example.test');
  assert.match(sentAlerts[0].subject, /\[HIGH\]/);
  assert.match(sentAlerts[0].subject, /repeated rate-limit exceedance/);
  assert.match(sentAlerts[0].subject, new RegExp(purpose));

  const rows = await sql<{ identifier_hash: string; origin_hash: string }[]>`
    select identifier_hash,origin_hash from idoc.account_request_limits where purpose=${purpose}`;
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.notEqual(row.identifier_hash, email);
    assert.notEqual(row.origin_hash, origin);
    assert.match(row.identifier_hash, /^[0-9a-f]{64}$/, 'the bucket key must be a digest, not the raw email');
    assert.match(row.origin_hash, /^[0-9a-f]{64}$/, 'the bucket key must be a digest, not the raw IP');
  }
});

test('a single blocked window alone (no sustained pattern) never triggers an alert', async () => {
  const purpose = 'test_isolated_purpose';
  const email = 'ordinary-user@example.test';
  const origin = '203.0.113.9';
  const windowNow = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + 1_000);

  const allowed = await exhaustEmailBucketOnce(purpose, email, origin, windowNow);
  assert.equal(allowed, false);
  assert.equal(sentAlerts.length, 0, 'one blocked window is routine and must not page an operator');
});

test('a second sustained streak for a different bucket is not suppressed by the first bucket\'s alert cooldown', async () => {
  const purpose = 'test_multi_bucket_purpose';
  const origin = '203.0.113.7';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);

  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    const windowNow = new Date(base + windowIndex * WINDOW_MS + 1_000);
    await exhaustEmailBucketOnce(purpose, 'first-account@example.test', origin, windowNow);
  }
  assert.equal(sentAlerts.length, 1);

  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    const windowNow = new Date(base + windowIndex * WINDOW_MS + 1_000);
    await exhaustEmailBucketOnce(purpose, 'second-account@example.test', origin, windowNow);
  }
  assert.equal(sentAlerts.length, 2, 'a distinct bucket hitting the same sustained pattern must alert independently');
});

test('a transient delivery failure on the threshold-crossing attempt does not suppress the retry within the same cooldown window', async () => {
  // A Codex review on this pull request caught that the cooldown marker was originally recorded
  // before the send was even attempted, so a single provider hiccup on the alert-worthy request would
  // silently lose the correlated attack alert for the rest of the hour. This proves the fix: the first
  // threshold-crossing request fails to deliver, and a subsequent denied request in the very same
  // bucket/window still gets a real alert through rather than being suppressed by a falsely-recorded
  // cooldown.
  const purpose = 'test_retry_after_failure';
  const email = 'attacker-retry@example.test';
  const origin = '203.0.113.11';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);

  for (let windowIndex = 0; windowIndex < 2; windowIndex += 1) {
    const windowNow = new Date(base + windowIndex * WINDOW_MS + 1_000);
    await exhaustEmailBucketOnce(purpose, email, origin, windowNow);
  }
  assert.equal(sentAlerts.length, 0, 'sanity: below threshold, no alert yet');

  const thresholdWindow = new Date(base + 2 * WINDOW_MS + 1_000);
  failNextDelivery = true;
  await exhaustEmailBucketOnce(purpose, email, origin, thresholdWindow);
  assert.equal(sentAlerts.length, 0, 'the delivery failure must not be silently counted as a successful alert');

  // A further denied request in the same bucket, still inside the same cooldown window.
  await checkRateLimit(purpose, email, origin, new Date(thresholdWindow.getTime() + 100));
  assert.equal(sentAlerts.length, 1, 'the retry must still succeed -- the earlier failed attempt must not have recorded a cooldown');
});
