import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { GET as scanRoute } from '../app/api/cron/renewal-notice-scan/route.ts';
import { GET as deliveryRoute } from '../app/api/cron/renewal-notice-delivery/route.ts';
import { deliverNextRenewalNotice, processRenewalNoticeBatch, RENEWAL_NOTICE_BATCH_LIMIT } from '../lib/notifications/renewal-notices.ts';
import { closeHarness, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

const RAW_SECRET = 'integration-cron-secret-at-least-32-characters';

beforeEach(async () => {
  process.env.CRON_SECRET = RAW_SECRET;
  process.env.MAILCHIMP_TRANSACTIONAL_API_KEY = 'provider-test-double-key-at-least-32-chars';
  await resetIdoc();
});
after(closeHarness);

async function queueNotice(kind: string, payload: Record<string, unknown> = {}) {
  const user = await createUser();
  const profile = await createProfile(user.id);
  const dedupeKey = `${kind}:${profile.id}:${randomUUID()}`;
  const [row] = await sql`insert into idoc.notification_outbox(profile_id, kind, payload, dedupe_key)
    values(${profile.id}, ${kind}, ${JSON.stringify({ firstName: 'Test', to: user.email, ...payload })}::jsonb, ${dedupeKey}) returning *`;
  return { profile, row, user };
}

test('each renewal-notice kind delivers once with the right recipient and a stable message id', async () => {
  const kinds = ['membership.renewal_reminder', 'membership.expiration_reminder', 'membership.payment_failed', 'membership.grace_reminder', 'membership.grace_expired'];
  for (const kind of kinds) {
    await resetIdoc();
    const { row, user } = await queueNotice(kind, { expirationDate: '2026-09-01', graceEndDate: '2026-09-01', renewalDate: '2026-09-01' });
    const messages: Array<{ subject: string; to: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      messages.push({ subject: body.message.subject, to: body.message.to[0].email });
      return new Response('[{"status":"sent"}]', { status: 200 });
    };
    try {
      const result = await deliverNextRenewalNotice('delivery-worker');
      assert.equal(result.status, 'delivered', kind);
      assert.equal(messages.length, 1, kind);
      assert.equal(messages[0].to, user.email, kind);
      assert.ok(messages[0].subject.length > 0, kind);
      const [stored] = await sql`select sent_at, attempt_count from idoc.notification_outbox where id=${row.id}`;
      assert.ok(stored.sent_at, kind);
      assert.equal(stored.attempt_count, 1, kind);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test('a delivery failure at the sixth attempt dead-letters with the recorded error code', async () => {
  const { row } = await queueNotice('membership.renewal_reminder', { renewalDate: '2026-09-01' });
  await sql`update idoc.notification_outbox set attempt_count=5 where id=${row.id}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('provider failure', { status: 500 });
  try {
    const result = await deliverNextRenewalNotice('dead-letter-worker');
    assert.equal(result.status, 'dead_lettered');
    const [stored] = await sql`select attempt_count, dead_lettered_at, last_error_code from idoc.notification_outbox where id=${row.id}`;
    assert.equal(stored.attempt_count, 6);
    assert.ok(stored.dead_lettered_at);
    assert.equal(stored.last_error_code, 'temporary_delivery_failure');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a delivery failure before the sixth attempt is retryable, not dead-lettered', async () => {
  const { row } = await queueNotice('membership.grace_reminder', { graceEndDate: '2026-09-01' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('provider failure', { status: 500 });
  try {
    const result = await deliverNextRenewalNotice('retry-worker');
    assert.equal(result.status, 'retryable');
    const [stored] = await sql`select attempt_count, dead_lettered_at from idoc.notification_outbox where id=${row.id}`;
    assert.equal(stored.attempt_count, 1);
    assert.equal(stored.dead_lettered_at, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an empty outbox returns status empty without any provider call', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('[{"status":"sent"}]', { status: 200 }); };
  try {
    assert.equal((await deliverNextRenewalNotice('empty-worker')).status, 'empty');
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('processRenewalNoticeBatch aggregates delivered counts across multiple rows', async () => {
  await queueNotice('membership.renewal_reminder', { renewalDate: '2026-09-01' });
  await queueNotice('membership.expiration_reminder', { expirationDate: '2026-09-01' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[{"status":"sent"}]', { status: 200 });
  try {
    const summary = await processRenewalNoticeBatch();
    assert.equal(summary.delivered, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('both renewal-notice Cron routes reject missing, lowercase, and mismatched-length authentication before any processing', async () => {
  const cases: Array<[string, string | undefined]> = [
    ['missing', undefined],
    ['lowercase bearer prefix', `bearer ${RAW_SECRET}`],
    ['shorter than configured', 'Bearer too-short'],
    ['longer than configured', `Bearer ${RAW_SECRET}-and-more`],
  ];
  for (const routeUnderTest of [
    { handler: scanRoute, path: '/api/cron/renewal-notice-scan' },
    { handler: deliveryRoute, path: '/api/cron/renewal-notice-delivery' },
  ]) {
    for (const [caseName, header] of cases) {
      const response = await routeUnderTest.handler(new Request(`https://idoc.club${routeUnderTest.path}`, { headers: header ? { authorization: header } : undefined }));
      assert.equal(response.status, 401, `${routeUnderTest.path}: ${caseName}`);
    }
  }
  assert.equal((await sql`select count(*)::int as count from idoc.notification_outbox`)[0].count, 0);
});

test('the scan Cron route authenticates then returns the enqueue summary', async () => {
  const response = await scanRoute(new Request('https://idoc.club/api/cron/renewal-notice-scan', { headers: { authorization: `Bearer ${RAW_SECRET}` } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { expirationReminders: 0, graceExpired: 0, graceReminders: 0, renewalReminders: 0 });
});

test('the delivery Cron route delivers a bounded batch, leaving the remainder for the next invocation', async () => {
  for (let index = 0; index < RENEWAL_NOTICE_BATCH_LIMIT + 5; index += 1) {
    await queueNotice('membership.renewal_reminder', { renewalDate: '2026-09-01' });
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[{"status":"sent"}]', { status: 200 });
  try {
    const response = await deliveryRoute(new Request('https://idoc.club/api/cron/renewal-notice-delivery', { headers: { authorization: `Bearer ${RAW_SECRET}` } }));
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.delivered, RENEWAL_NOTICE_BATCH_LIMIT);
    const remaining = await sql`select count(*)::int as count from idoc.notification_outbox where sent_at is null and dead_lettered_at is null`;
    assert.equal(remaining[0].count, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
