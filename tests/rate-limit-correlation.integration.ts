import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { checkRateLimit } from '../lib/security/rate-limit.ts';
import { deliverNextOperationalAlert, processOperationalAlertBatch } from '../lib/notifications/operational-alert-delivery.ts';
import { closeHarness, resetIdoc, sql } from './postgres-harness.ts';

// AUTH-OPERATIONS-006: repeated rate-limit exceedances of the same bucket across multiple windows
// must be correlated into a single, durably-queued operator alert, not left as N silent
// individually-rejected requests, and never delivered by blocking the authentication-adjacent
// request that triggered it. Drives the real production checkRateLimit function -- not a parallel
// helper -- across several genuinely distinct 15-minute windows to reproduce the actual
// sustained-blocking shape this control targets, and separately drives the real production delivery
// worker (deliverNextOperationalAlert/processOperationalAlertBatch) to prove the durable,
// leased, retrying handoff a Codex review found missing.

const WINDOW_MS = 15 * 60 * 1000;

Object.assign(process.env, {
  AUTH_SECRET: 'rate-limit-correlation-test-secret-long-enough',
  IDOC_ADMIN_NOTIFICATION_EMAIL: 'ops@example.test',
  MAILCHIMP_TRANSACTIONAL_API_KEY: 'integration-only-provider-key-32-chars-plus',
  RATE_LIMIT_HASH_KEY: 'rate-limit-correlation-test-secret-long-enough',
});

const originalFetch = globalThis.fetch;
let sentAlerts: { subject: string; to: string }[] = [];
let failNextDeliveries = 0;
let fetchCallCount = 0;
beforeEach(async () => {
  await resetIdoc();
  sentAlerts = [];
  failNextDeliveries = 0;
  fetchCallCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://mandrillapp.com/api/1.0/messages/send.json') {
      fetchCallCount += 1;
      if (failNextDeliveries > 0) { failNextDeliveries -= 1; return new Response('provider unavailable', { status: 502 }); }
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

async function outboxRows(kind = 'rate_limit_correlation_alert') {
  return sql<{ dedupe_key: string; sent_at: Date | null; subject: string }[]>`
    select dedupe_key,sent_at,subject from idoc.operational_alert_outbox where kind=${kind}`;
}

test('an account blocked by the same rate limit in 3 of the last 4 windows durably enqueues one operator alert without any network call', async () => {
  const purpose = 'test_sustained_purpose';
  const email = 'attacker@example.test';
  const origin = '203.0.113.5';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);

  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    const windowNow = new Date(base + windowIndex * WINDOW_MS + 1_000);
    const allowed = await exhaustEmailBucketOnce(purpose, email, origin, windowNow);
    assert.equal(allowed, false, 'the 4th request within a 3-request window must already be denied');
  }

  assert.equal(fetchCallCount, 0, 'checkRateLimit itself must never make a network call -- only a durable enqueue');
  const rows = await outboxRows();
  assert.equal(rows.length, 1, 'the sustained pattern across 3 windows must durably enqueue exactly one alert');
  assert.equal(rows[0].sent_at, null, 'not yet delivered -- delivery is a separate, off-path worker');
  assert.match(rows[0].subject, /\[HIGH\]/);
  assert.match(rows[0].subject, /repeated rate-limit exceedance/);
  assert.match(rows[0].subject, new RegExp(purpose));

  const bucketRows = await sql<{ identifier_hash: string; origin_hash: string }[]>`
    select identifier_hash,origin_hash from idoc.account_request_limits where purpose=${purpose}`;
  assert.ok(bucketRows.length > 0);
  for (const row of bucketRows) {
    assert.notEqual(row.identifier_hash, email);
    assert.notEqual(row.origin_hash, origin);
    assert.match(row.identifier_hash, /^[0-9a-f]{64}$/, 'the bucket key must be a digest, not the raw email');
    assert.match(row.origin_hash, /^[0-9a-f]{64}$/, 'the bucket key must be a digest, not the raw IP');
  }
});

test('a single blocked window alone (no sustained pattern) never enqueues an alert', async () => {
  const purpose = 'test_isolated_purpose';
  const email = 'ordinary-user@example.test';
  const origin = '203.0.113.9';
  const windowNow = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + 1_000);

  const allowed = await exhaustEmailBucketOnce(purpose, email, origin, windowNow);
  assert.equal(allowed, false);
  assert.equal((await outboxRows()).length, 0, 'one blocked window is routine and must not page an operator');
});

test('a second sustained streak for a different bucket enqueues independently, not suppressed by the first bucket\'s cooldown', async () => {
  const purpose = 'test_multi_bucket_purpose';
  const origin = '203.0.113.7';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);

  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    const windowNow = new Date(base + windowIndex * WINDOW_MS + 1_000);
    await exhaustEmailBucketOnce(purpose, 'first-account@example.test', origin, windowNow);
  }
  assert.equal((await outboxRows()).length, 1);

  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    const windowNow = new Date(base + windowIndex * WINDOW_MS + 1_000);
    await exhaustEmailBucketOnce(purpose, 'second-account@example.test', origin, windowNow);
  }
  const rows = await outboxRows();
  assert.equal(rows.length, 2, 'a distinct bucket hitting the same sustained pattern must alert independently');
  assert.notEqual(rows[0].dedupe_key, rows[1].dedupe_key);
});

test('repeated denied requests within the same cooldown window enqueue exactly once (idempotent dedupe, not a duplicate row per request)', async () => {
  const purpose = 'test_repeat_denials_purpose';
  const email = 'repeat-offender@example.test';
  const origin = '203.0.113.13';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);

  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    const windowNow = new Date(base + windowIndex * WINDOW_MS + 1_000);
    await exhaustEmailBucketOnce(purpose, email, origin, windowNow);
  }
  // Several more denied requests in the same (already-threshold-crossing) window.
  const thresholdWindow = new Date(base + 2 * WINDOW_MS + 1_000);
  await checkRateLimit(purpose, email, origin, new Date(thresholdWindow.getTime() + 200));
  await checkRateLimit(purpose, email, origin, new Date(thresholdWindow.getTime() + 300));

  assert.equal((await outboxRows()).length, 1, 'the unique dedupe_key must absorb repeat enqueue attempts for the same bucket/window');
});

test('the real delivery worker sends a queued alert and marks it delivered', async () => {
  const purpose = 'test_delivery_purpose';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    await exhaustEmailBucketOnce(purpose, 'delivery-test@example.test', '203.0.113.20', new Date(base + windowIndex * WINDOW_MS + 1_000));
  }
  assert.equal((await outboxRows()).length, 1);
  assert.equal(sentAlerts.length, 0);

  const result = await deliverNextOperationalAlert();
  assert.equal(result.status, 'delivered');
  assert.equal(sentAlerts.length, 1);
  assert.equal(sentAlerts[0].to, 'ops@example.test');
  assert.match(sentAlerts[0].subject, new RegExp(purpose));

  const [row] = await outboxRows();
  assert.ok(row.sent_at);
  assert.equal((await deliverNextOperationalAlert()).status, 'empty', 'a delivered alert must not be redelivered');
});

test('a transient delivery failure schedules a retry rather than dead-lettering immediately, and the retry succeeds', async () => {
  const purpose = 'test_retry_purpose';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    await exhaustEmailBucketOnce(purpose, 'retry-test@example.test', '203.0.113.21', new Date(base + windowIndex * WINDOW_MS + 1_000));
  }

  failNextDeliveries = 1;
  const first = await deliverNextOperationalAlert();
  assert.equal(first.status, 'retryable');
  assert.equal(sentAlerts.length, 0);

  const [rowAfterFailure] = await sql<{ attempt_count: number; available_at: string; dead_lettered_at: string | null }[]>`
    select attempt_count,available_at,dead_lettered_at from idoc.operational_alert_outbox where kind='rate_limit_correlation_alert'`;
  assert.equal(rowAfterFailure.attempt_count, 1);
  assert.equal(rowAfterFailure.dead_lettered_at, null);
  assert.ok(new Date(rowAfterFailure.available_at).getTime() > Date.now(), 'a failed attempt must back off before becoming available again');

  // Force it available now (bypassing the real backoff delay -- the backoff duration itself isn't
  // what this test is proving) and retry.
  await sql`update idoc.operational_alert_outbox set available_at=now() where kind='rate_limit_correlation_alert'`;
  const second = await deliverNextOperationalAlert();
  assert.equal(second.status, 'delivered');
  assert.equal(sentAlerts.length, 1);
});

test('a delivery that keeps failing is dead-lettered after the maximum attempts, never retried forever', async () => {
  const purpose = 'test_dead_letter_purpose';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    await exhaustEmailBucketOnce(purpose, 'dead-letter-test@example.test', '203.0.113.22', new Date(base + windowIndex * WINDOW_MS + 1_000));
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    failNextDeliveries = 1;
    await deliverNextOperationalAlert();
    await sql`update idoc.operational_alert_outbox set available_at=now() where kind='rate_limit_correlation_alert'`;
  }

  const [row] = await sql<{ attempt_count: number; dead_lettered_at: Date | null; sent_at: Date | null }[]>`
    select attempt_count,dead_lettered_at,sent_at from idoc.operational_alert_outbox where kind='rate_limit_correlation_alert'`;
  assert.equal(row.attempt_count, 6);
  assert.ok(row.dead_lettered_at);
  assert.equal(row.sent_at, null);
  assert.equal(sentAlerts.length, 0);
  assert.equal((await deliverNextOperationalAlert()).status, 'empty', 'a dead-lettered alert must never be claimed again');
});

test('two concurrent delivery attempts on the same queued alert never double-send it', async () => {
  const purpose = 'test_concurrency_purpose';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    await exhaustEmailBucketOnce(purpose, 'concurrency-test@example.test', '203.0.113.23', new Date(base + windowIndex * WINDOW_MS + 1_000));
  }

  const [first, second] = await Promise.all([deliverNextOperationalAlert(), deliverNextOperationalAlert()]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, ['delivered', 'empty'], 'exactly one concurrent claim must win; the other finds nothing left to claim');
  assert.equal(sentAlerts.length, 1, 'the alert must be sent exactly once despite the concurrent attempts');
});

test('an unconfigured admin recipient leaves the alert queued for later delivery rather than dead-lettering or dropping it', async () => {
  const purpose = 'test_unconfigured_purpose';
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
    await exhaustEmailBucketOnce(purpose, 'unconfigured-test@example.test', '203.0.113.24', new Date(base + windowIndex * WINDOW_MS + 1_000));
  }

  const original = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
  delete process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
  try {
    const result = await deliverNextOperationalAlert();
    assert.equal(result.status, 'unconfigured');
  } finally {
    process.env.IDOC_ADMIN_NOTIFICATION_EMAIL = original;
  }

  const [row] = await sql<{ attempt_count: number; dead_lettered_at: Date | null; sent_at: Date | null }[]>`
    select attempt_count,dead_lettered_at,sent_at from idoc.operational_alert_outbox where kind='rate_limit_correlation_alert'`;
  assert.equal(row.attempt_count, 0, 'an unconfigured recipient must not consume a retry attempt');
  assert.equal(row.dead_lettered_at, null);
  assert.equal(row.sent_at, null);

  const delivered = await deliverNextOperationalAlert();
  assert.equal(delivered.status, 'delivered', 'once configured, the still-queued alert delivers normally');
});

test('processOperationalAlertBatch delivers every queued alert up to its limit', async () => {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  for (const suffix of ['a', 'b', 'c']) {
    for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
      await exhaustEmailBucketOnce(`test_batch_purpose_${suffix}`, `batch-${suffix}@example.test`, `203.0.113.${30 + suffix.charCodeAt(0)}`,
        new Date(base + windowIndex * WINDOW_MS + 1_000));
    }
  }
  assert.equal((await outboxRows()).length, 3);

  const summary = await processOperationalAlertBatch();
  assert.equal(summary.delivered, 3);
  assert.equal(sentAlerts.length, 3);
});
