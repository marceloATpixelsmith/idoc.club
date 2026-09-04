import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { enqueueAuthSecurityNotification } from '../lib/notifications/auth-security-events.ts';
import { deliverNextAuthSecurityNotification } from '../lib/notifications/auth-security-delivery.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// AUTH-OPERATIONS-006/007's real evidence for idoc.account_delivery_outbox
// (tests/account-delivery-worker.integration.ts) and idoc.operational_alert_outbox
// (tests/rate-limit-correlation.integration.ts) forces a real transient failure and a real
// dead-letter through their respective production delivery functions. deliverNextAuthSecurityNotification
// -- the third leased/retrying outbox worker, behind every "authenticator replaced",
// "recovery codes regenerated", "new sign-in", etc. notification -- had no equivalent: the only test
// referencing it checked an unrelated Date-serialization bug via source inspection, never a real
// forced failure. This file closes that gap the same way the other two do: mocking only the real
// outbound Brevo HTTP call (never a parallel helper), driving the real production
// deliverNextAuthSecurityNotification function against real Postgres.

Object.assign(process.env, {
  AUTH_SECRET: 'auth-security-notification-delivery-test-secret-32-chars',
  BREVO_API_KEY: 'integration-only-provider-key',
  BREVO_FROM_EMAIL: 'accounts@idoc.club',
});

const originalFetch = globalThis.fetch;
let sentMessages: { subject: string; to: string }[] = [];
let failNextDeliveries = 0;
beforeEach(async () => {
  await resetIdoc();
  sentMessages = [];
  failNextDeliveries = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://api.brevo.com/v3/smtp/email') {
      if (failNextDeliveries > 0) { failNextDeliveries -= 1; return new Response('provider unavailable', { status: 502 }); }
      const body = JSON.parse(String(init?.body));
      sentMessages.push({ subject: body.subject, to: body.to[0].email });
      return new Response('{"messageId":"<test@smtp-relay.brevo.com>"}', { status: 201 });
    }
    return originalFetch(input, init);
  };
});
after(async () => { globalThis.fetch = originalFetch; await closeHarness(); });

async function queue(kind: 'authenticator_enrolled' | 'recovery_codes_regenerated' = 'authenticator_enrolled') {
  const user = await createUser();
  const enqueued = await enqueueAuthSecurityNotification({
    dedupeKey: `test:${kind}:${user.id}:${randomUUID()}`, kind, recipientEmail: user.email, userId: user.id,
  });
  assert.equal(enqueued, true);
  const [row] = await sql`select * from idoc.auth_security_notification_outbox where user_id=${user.id}`;
  assert.ok(row);
  return { row, user };
}

test('a queued security notification is delivered once with the real recipient and subject', async () => {
  const { row, user } = await queue('authenticator_enrolled');
  const result = await deliverNextAuthSecurityNotification();
  assert.equal(result.status, 'delivered');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, user.email);
  assert.match(sentMessages[0].subject, /Authenticator enabled/);
  const [stored] = await sql`select * from idoc.auth_security_notification_outbox where id=${row.id}`;
  assert.ok(stored.sent_at);
  assert.equal(stored.attempt_count, 1);
  assert.equal(stored.lease_owner, null);
  assert.equal((await deliverNextAuthSecurityNotification()).status, 'empty', 'a delivered notification must not be redelivered');
});

test('a transient delivery failure schedules a backoff retry rather than dead-lettering immediately, and the retry succeeds', async () => {
  const { row } = await queue('recovery_codes_regenerated');
  failNextDeliveries = 1;
  const first = await deliverNextAuthSecurityNotification();
  assert.equal(first.status, 'retryable');
  assert.equal(sentMessages.length, 0);

  const [afterFailure] = await sql<{ attempt_count: number; available_at: string; dead_lettered_at: string | null; last_error_code: string | null }[]>`
    select attempt_count,available_at,dead_lettered_at,last_error_code from idoc.auth_security_notification_outbox where id=${row.id}`;
  assert.equal(afterFailure.attempt_count, 1);
  assert.equal(afterFailure.dead_lettered_at, null);
  assert.equal(afterFailure.last_error_code, 'temporary_delivery_failure');
  assert.ok(new Date(afterFailure.available_at).getTime() > Date.now(), 'a failed attempt must back off before becoming available again');

  // The backoff duration itself is proven by the identical formula already covered in
  // account-delivery-worker.integration.ts; here only the retry-then-succeed transition matters.
  await sql`update idoc.auth_security_notification_outbox set available_at=now() where id=${row.id}`;
  const second = await deliverNextAuthSecurityNotification();
  assert.equal(second.status, 'delivered');
  assert.equal(sentMessages.length, 1);
  const [stored] = await sql`select sent_at,attempt_count from idoc.auth_security_notification_outbox where id=${row.id}`;
  assert.ok(stored.sent_at);
  assert.equal(stored.attempt_count, 2);
});

test('a delivery that keeps failing is dead-lettered after the maximum attempts, never retried forever', async () => {
  const { row } = await queue('authenticator_enrolled');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    failNextDeliveries = 1;
    await deliverNextAuthSecurityNotification();
    await sql`update idoc.auth_security_notification_outbox set available_at=now() where id=${row.id}`;
  }
  const [stored] = await sql<{ attempt_count: number; dead_lettered_at: Date | null; sent_at: Date | null }[]>`
    select attempt_count,dead_lettered_at,sent_at from idoc.auth_security_notification_outbox where id=${row.id}`;
  assert.equal(stored.attempt_count, 6);
  assert.ok(stored.dead_lettered_at);
  assert.equal(stored.sent_at, null);
  assert.equal(sentMessages.length, 0);
  assert.equal((await deliverNextAuthSecurityNotification()).status, 'empty', 'a dead-lettered notification must never be claimed again');
});

test('two concurrent delivery attempts on the same queued notification never double-send it', async () => {
  await queue('authenticator_enrolled');
  const [first, second] = await Promise.all([deliverNextAuthSecurityNotification(), deliverNextAuthSecurityNotification()]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, ['delivered', 'empty'], 'exactly one concurrent claim must win; the other finds nothing left to claim');
  assert.equal(sentMessages.length, 1, 'the notification must be sent exactly once despite the concurrent attempts');
});
