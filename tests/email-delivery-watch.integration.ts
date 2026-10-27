import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { GET as watchCron } from '../app/api/cron/email-delivery-watch/route.ts';
import { runEmailDeliveryWatch } from '../lib/notifications/email-delivery-watch.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// The email delivery watch (docs/05, docs/07): an email Brevo accepted but never delivered, and a member who keeps requesting codes
// that are never entered, are queued as operational alerts for IDOC_ADMIN_NOTIFICATION_EMAIL, once each.

Object.assign(process.env, {
  AUTH_SECRET: 'integration-auth-secret-that-is-long-enough',
  BASE_URL: 'https://idoc.club',
  BREVO_API_KEY: 'integration-only-provider-key',
  BREVO_FROM_EMAIL: 'accounts@idoc.club',
  CRON_SECRET: 'watch-cron-secret-that-is-long-enough-for-tests',
  DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'false',
  IDOC_ADMIN_NOTIFICATION_EMAIL: 'ops@idoc.club',
  RATE_LIMIT_HASH_KEY: 'integration-rate-limit-secret-is-long-enough',
});

const originalFetch = globalThis.fetch;
let brevoEvents: { date: string; email: string; event: string; messageId: string; reason?: string }[];
let statisticsStatus: number;
beforeEach(async () => {
  await resetIdoc();
  brevoEvents = [];
  statisticsStatus = 200;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.startsWith('https://api.brevo.com/v3/smtp/statistics/events')) {
      return statisticsStatus === 200 ? Response.json({ events: brevoEvents }) : new Response('{}', { status: statisticsStatus });
    }
    if (url === 'https://api.brevo.com/v3/smtp/email') return new Response('{"messageId":"<alert@relay>"}', { status: 201 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});
after(async () => { globalThis.fetch = originalFetch; await closeHarness(); });

const now = new Date();
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

async function logEmail(overrides: { email?: string; kind?: string | null; minutes?: number; status?: string; userId?: number | null; messageId?: string } = {}) {
  const email = overrides.email ?? 'sd.ferrer@wanadoo.fr';
  const [row] = await sql<{ id: number }[]>`
    insert into idoc.email_delivery_log(provider_message_id, recipient_email, recipient_domain, user_id, kind, subject, sent_at, status, status_at)
    values (${overrides.messageId ?? `m-${Math.random().toString(36).slice(2)}@relay`}, ${email}, ${email.split('@')[1]}, ${overrides.userId ?? null},
      ${overrides.kind === undefined ? 'auth.otp.login_verification' : overrides.kind}, 'Your IDOC sign-in code', ${minutesAgo(overrides.minutes ?? 9)}::timestamptz,
      ${overrides.status ?? 'accepted'}, ${minutesAgo(overrides.minutes ?? 9)}::timestamptz) returning id`;
  return row.id;
}
const alerts = async () => (await sql<{ body_html: string; dedupe_key: string; kind: string; subject: string }[]>`
  select kind, subject, body_html, dedupe_key from idoc.operational_alert_outbox order by id`).map((row) => ({ ...row }));

test('a sign-in code not delivered after 5 minutes is reported once, with everything needed to troubleshoot it', async () => {
  const user = await createUser();
  const id = await logEmail({ userId: user.id, email: user.email });
  await sql`insert into idoc.email_delivery_events(log_id, event, occurred_at, reason) values (${id}, 'deferred', ${minutesAgo(8)}::timestamptz, '421 try again later')`;
  await sql`update idoc.email_delivery_log set status='deferred' where id=${id}`;

  const first = await runEmailDeliveryWatch(now);
  assert.equal(first.alerted, 1);
  const [alert] = await alerts();
  assert.equal(alert.kind, 'email_delivery_problem');
  assert.equal(alert.dedupe_key, `email-delivery-problem:${id}:late`);
  assert.match(alert.subject, /email not delivered — sign-in code to example\.test/);
  for (const expected of [user.email, '421 try again later', 'deferred', `user #${user.id}`, 'Brevo message id', 'Deadline used']) assert.ok(alert.body_html.includes(expected), expected);

  assert.equal((await runEmailDeliveryWatch(now)).alerted, 0, 'the same email is not reported again');
  assert.equal((await alerts()).length, 1);
});

test('nothing is reported for a delivered email, one still inside its deadline, or one sent to the administrator', async () => {
  await logEmail({ status: 'delivered' });
  await logEmail({ minutes: 2 });
  await logEmail({ kind: 'account.password_reset', minutes: 20 });
  await logEmail({ email: 'ops@idoc.club' });
  assert.equal((await runEmailDeliveryWatch(now)).alerted, 0);
  assert.equal((await alerts()).length, 0);
});

test('a permanent failure is reported at once, and an email still undelivered after 24 hours is reported as final', async () => {
  await logEmail({ minutes: 1, status: 'hard_bounced', email: 'gone@example.test' });
  await logEmail({ kind: 'account.migration_activation', minutes: 25 * 60, email: 'slow@example.test' });
  assert.equal((await runEmailDeliveryWatch(now)).alerted, 2);
  const keys = (await alerts()).map((alert) => alert.dedupe_key.split(':')[2]).sort();
  assert.deepEqual(keys, ['failed', 'final']);
});

test('an overdue email Brevo says it delivered is corrected, not alerted, so a missing webhook cannot cause a false alarm', async () => {
  const id = await logEmail({ messageId: 'delivered@relay' });
  brevoEvents = [
    { date: minutesAgo(8), email: 'sd.ferrer@wanadoo.fr', event: 'delivered', messageId: '<delivered@relay>' },
    { date: minutesAgo(8), email: 'sd.ferrer@wanadoo.fr', event: 'hardBounces', messageId: '<someone-elses@relay>', reason: 'not ours' },
  ];
  const result = await runEmailDeliveryWatch(now);
  assert.deepEqual({ alerted: result.alerted, reconciled: result.reconciled }, { alerted: 0, reconciled: 1 });
  const [row] = await sql`select status from idoc.email_delivery_log where id=${id}`;
  assert.equal(row.status, 'delivered');
});

test('when Brevo has nothing for the message, or cannot be reached, the alert says so', async () => {
  await logEmail({ email: 'quiet@example.test' });
  statisticsStatus = 500;
  await logEmail({ email: 'down@example.test' });
  await runEmailDeliveryWatch(now);
  const bodies = (await alerts()).map((alert) => alert.body_html);
  assert.equal(bodies.length, 2);
  assert.ok(bodies.some((body) => body.includes('could not reach Brevo')));
});

test('three codes requested in 15 minutes and none entered is reported with how each email fared', async () => {
  const email = 'sd.ferrer@wanadoo.fr';
  for (const minutes of [10, 7, 3]) {
    await sql`insert into idoc.email_otp_codes(email, purpose, code_hash, expires_at, created_at) values (${email}, 'login_verification', 'h', ${minutesAgo(-5)}::timestamptz, ${minutesAgo(minutes)}::timestamptz)`;
    await logEmail({ email, minutes, status: 'delivered' });
  }
  const result = await runEmailDeliveryWatch(now);
  assert.equal(result.repeatAlerted, 1);
  const repeated = (await alerts()).find((alert) => alert.kind === 'repeated_code_requests');
  assert.ok(repeated);
  assert.match(repeated.body_html, /never entered one\. They most likely cannot find the email/);
  assert.equal((await runEmailDeliveryWatch(now)).repeatAlerted, 0, 'once per address and hour');
});

test('codes the member actually tried to enter are not a repeated-request alert', async () => {
  for (const [minutes, attempts] of [[10, 0], [7, 1], [3, 0]]) {
    await sql`insert into idoc.email_otp_codes(email, purpose, code_hash, expires_at, created_at, attempt_count) values ('typed@example.test', 'login_verification', 'h', ${minutesAgo(-5)}::timestamptz, ${minutesAgo(minutes)}::timestamptz, ${attempts})`;
  }
  assert.equal((await runEmailDeliveryWatch(now)).repeatAlerted, 0);
});

test('the watch cron rejects an unauthenticated call and, when authorized, runs the watch and returns only counts', async () => {
  await logEmail({ email: 'cron@example.test' });
  assert.equal((await watchCron(new Request('https://idoc.club/api/cron/email-delivery-watch'))).status, 401);
  assert.equal((await alerts()).length, 0, 'an unauthenticated call does nothing');
  const response = await watchCron(new Request('https://idoc.club/api/cron/email-delivery-watch', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, number>;
  assert.equal(body.alerted, 1);
  assert.deepEqual(Object.keys(body).sort(), ['alerted', 'alertsRetryable', 'reconciled', 'repeatAlerted']);
});
