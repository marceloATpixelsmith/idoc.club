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
  assert.equal(typeof body.journeyConcerns, 'number');
  assert.equal(typeof body.journeyDigestQueued, 'number');
  assert.deepEqual(Object.keys(body).sort(), ['alerted', 'alertsRetryable', 'held', 'journeyConcerns', 'journeyDigestQueued', 'reconciled', 'repeatAlerted']);
});

test('emails already reported can never crowd a newer undelivered email out of the batch', async () => {
  for (let index = 0; index < 210; index += 1) await logEmail({ email: `old-${index}@example.test`, minutes: 60 });
  // Every one of the 210 has its alert queued already (an hour ago, so the hourly cap is untouched).
  await sql`insert into idoc.operational_alert_outbox(kind, subject, body_html, dedupe_key, created_at, sent_at)
    select 'email_delivery_problem', 's', 'b', 'email-delivery-problem:' || id || ':late', now() - interval '2 hours', now() - interval '2 hours' from idoc.email_delivery_log`;
  await logEmail({ email: 'fresh@example.test', minutes: 9 });
  const result = await runEmailDeliveryWatch(now);
  assert.equal(result.alerted, 1, 'the newest overdue email is still reported');
  assert.ok((await alerts()).some((alert) => alert.subject.includes('example.test') && alert.body_html.includes('fresh@example.test')));
});

test('alerts are capped per hour, and past the cap one summary replaces the rest', async () => {
  for (let index = 0; index < 40; index += 1) await logEmail({ email: `burst-${index}@example.test`, minutes: 9 });
  await runEmailDeliveryWatch(now);
  await runEmailDeliveryWatch(now);
  const third = await runEmailDeliveryWatch(now);
  const fourth = await runEmailDeliveryWatch(now);
  const all = await alerts();
  const individual = all.filter((alert) => alert.dedupe_key.startsWith('email-delivery-problem:'));
  const summaries = all.filter((alert) => alert.dedupe_key.startsWith('email-delivery-flood:'));
  assert.equal(individual.length, 30, 'never more than 30 individual alerts in an hour');
  assert.equal(summaries.length, 1, 'one summary for the hour, however many runs');
  assert.equal(third.held, 10);
  assert.equal(fourth.alerted, 0);
  assert.match(summaries[0].body_html, /10 more emails need attention/);
});

test('repeated-request groups already reported this hour cannot crowd a new one out of the batch', async () => {
  const stale = Array.from({ length: 30 }, (_, index) => `stale-${index}@example.test`);
  for (const email of stale) {
    for (const minutes of [10, 7, 3]) await sql`insert into idoc.email_otp_codes(email, purpose, code_hash, expires_at, created_at) values (${email}, 'login_verification', 'h', ${minutesAgo(-5)}::timestamptz, ${minutesAgo(minutes)}::timestamptz)`;
  }
  await runEmailDeliveryWatch(now);
  await runEmailDeliveryWatch(now);
  const before = (await alerts()).filter((alert) => alert.kind === 'repeated_code_requests').length;
  assert.ok(before > 0 && before <= 30);
  for (const minutes of [9, 6, 2]) await sql`insert into idoc.email_otp_codes(email, purpose, code_hash, expires_at, created_at) values ('brand-new@example.test', 'login_verification', 'h', ${minutesAgo(-5)}::timestamptz, ${minutesAgo(minutes)}::timestamptz)`;
  await sql`update idoc.operational_alert_outbox set created_at = now() - interval '2 hours'`;
  await runEmailDeliveryWatch(now);
  assert.ok((await alerts()).some((alert) => alert.kind === 'repeated_code_requests' && alert.body_html.includes('brand-new@example.test')), 'the new group is reported');
});

test('a burst of undelivered emails cannot use up the repeated-code-request alerts, and each family reports what it held back', async () => {
  for (let index = 0; index < 40; index += 1) await logEmail({ email: `burst-${index}@example.test`, minutes: 9 });
  for (let round = 0; round < 3; round += 1) await runEmailDeliveryWatch(now);
  for (const minutes of [9, 6, 2]) await sql`insert into idoc.email_otp_codes(email, purpose, code_hash, expires_at, created_at) values ('stuck-member@example.test', 'login_verification', 'h', ${minutesAgo(-5)}::timestamptz, ${minutesAgo(minutes)}::timestamptz)`;
  const result = await runEmailDeliveryWatch(now);
  assert.equal(result.repeatAlerted, 1, 'the member in a code-request loop is still reported although the delivery cap is spent');
  const all = await alerts();
  assert.equal(all.filter((alert) => alert.dedupe_key.startsWith('email-delivery-problem:')).length, 30);
  assert.ok(all.some((alert) => alert.kind === 'repeated_code_requests' && alert.body_html.includes('stuck-member@example.test')));
});

test('repeated-request groups past their own cap are summarised separately, not silently dropped', async () => {
  for (let index = 0; index < 14; index += 1) {
    for (const minutes of [9, 6, 2]) await sql`insert into idoc.email_otp_codes(email, purpose, code_hash, expires_at, created_at) values (${`loop-${index}@example.test`}, 'login_verification', 'h', ${minutesAgo(-5)}::timestamptz, ${minutesAgo(minutes)}::timestamptz)`;
  }
  const result = await runEmailDeliveryWatch(now);
  assert.equal(result.repeatAlerted, 10, 'capped at 10 per hour');
  const summary = (await alerts()).find((alert) => alert.dedupe_key.startsWith('repeated-code-requests-flood:'));
  assert.ok(summary, 'a summary names the groups that were held back');
  assert.match(summary.body_html, /4 more members are requesting codes/);
  assert.equal((await runEmailDeliveryWatch(now)).repeatAlerted, 0);
  assert.equal((await alerts()).filter((alert) => alert.dedupe_key.startsWith('repeated-code-requests-flood:')).length, 1, 'one summary per hour');
});
