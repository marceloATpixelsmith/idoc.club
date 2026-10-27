import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { POST } from '../app/api/brevo/webhook/route.ts';
import { sendTransactionalEmail } from '../lib/notifications/brevo-transactional.ts';
import { purgeExpiredAuthRecords } from '../lib/security/data-retention-purge.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// The email delivery log (docs/05, docs/07): every email Brevo accepts is recorded with Brevo's own message id, and the Brevo
// webhook moves it from "accepted" to what actually happened to it. Drives the real transport and the real webhook route.

Object.assign(process.env, {
  AUTH_SECRET: 'integration-auth-secret-that-is-long-enough',
  BASE_URL: 'http://localhost:3000',
  BREVO_API_KEY: 'integration-only-provider-key',
  BREVO_FROM_EMAIL: 'accounts@idoc.club',
  BREVO_WEBHOOK_KEY: 'delivery-log-webhook-key',
  DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'false',
  IDOC_ADMIN_NOTIFICATION_EMAIL: 'ops@idoc.club',
  RATE_LIMIT_HASH_KEY: 'integration-rate-limit-secret-is-long-enough',
});

const originalFetch = globalThis.fetch;
let sequence = 0;
beforeEach(async () => {
  await resetIdoc();
  sequence = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url !== 'https://api.brevo.com/v3/smtp/email') throw new Error(`unexpected fetch ${url}`);
    sequence += 1;
    return new Response(JSON.stringify({ messageId: `<id-${sequence}@smtp-relay.test>` }), { status: 201 });
  }) as typeof fetch;
});
after(async () => { globalThis.fetch = originalFetch; await closeHarness(); });

const webhook = (body: unknown) => POST(new Request('https://idoc.club/api/brevo/webhook?key=delivery-log-webhook-key', {
  body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST',
}));
const logRows = (email: string) => sql<{ delivered_at: Date | null; kind: string | null; message_ref: string | null; provider_message_id: string | null; recipient_domain: string; recipient_email: string; status: string; subject: string | null; user_id: number | null }[]>`
  select * from idoc.email_delivery_log where recipient_email=${email} order by id`;
const events = async () => (await sql<{ event: string; reason: string | null }[]>`select event, reason from idoc.email_delivery_events order by id`).map((row) => ({ ...row }));

test('an accepted send is logged with Brevo message id, kind, subject and member, and never its body', async () => {
  const user = await createUser();
  await sendTransactionalEmail({ html: '<p>Your code is 123456</p>', messageId: 'ref-1', subject: 'Your IDOC sign-in code', to: user.email.toUpperCase() }, { kind: 'auth.otp.login_verification', userId: user.id });
  const [row] = await logRows(user.email.toLowerCase());
  assert.equal(row.provider_message_id, 'id-1@smtp-relay.test', 'angle brackets are stripped');
  assert.equal(row.status, 'accepted');
  assert.equal(row.kind, 'auth.otp.login_verification');
  assert.equal(row.user_id, user.id);
  assert.equal(row.message_ref, 'ref-1');
  assert.equal(row.subject, 'Your IDOC sign-in code');
  assert.equal(row.recipient_domain, user.email.split('@')[1].toLowerCase());
  assert.equal(JSON.stringify(row).includes('123456'), false, 'the code never reaches the log');
});

test('the delivered webhook completes the email once, and a redelivered or late earlier event changes nothing', async () => {
  const user = await createUser();
  await sendTransactionalEmail({ html: '<p>x</p>', subject: 'S', to: user.email }, { kind: 'account.password_reset' });
  const delivered = { email: user.email, event: 'delivered', 'message-id': '<id-1@smtp-relay.test>', ts_event: Math.floor(Date.now() / 1000) };
  assert.equal((await webhook(delivered)).status, 200);
  assert.equal((await webhook(delivered)).status, 200);
  const [row] = await logRows(user.email.toLowerCase());
  assert.equal(row.status, 'delivered');
  assert.ok(row.delivered_at, 'delivered_at is set');
  assert.equal((await events()).length, 1, 'the redelivered webhook is a no-op');

  await webhook({ email: user.email, event: 'deferred', 'message-id': '<id-1@smtp-relay.test>', reason: 'greylisted', ts_event: Math.floor(Date.now() / 1000) - 60 });
  assert.equal((await logRows(user.email.toLowerCase()))[0].status, 'delivered', 'a late deferred never downgrades a delivery');
  assert.deepEqual((await events()).map((event) => event.event), ['delivered', 'deferred'], 'but it stays in the history');
});

test('a snake_case hard_bounce marks the email bounced and still alerts the operator', async () => {
  const user = await createUser();
  await sendTransactionalEmail({ html: '<p>x</p>', subject: 'S', to: user.email });
  const response = await webhook({ email: user.email, event: 'hard_bounce', 'message-id': '<id-1@smtp-relay.test>', reason: 'mailbox does not exist' });
  assert.equal(response.status, 200);
  const [row] = await logRows(user.email.toLowerCase());
  assert.equal(row.status, 'hard_bounced');
  assert.deepEqual(await events(), [{ event: 'hard_bounced', reason: 'mailbox does not exist' }]);
  const [alert] = await logRows('ops@idoc.club');
  assert.match(alert.subject ?? '', /hard bounce/i, 'the operator alert was sent (and is itself logged)');
});

test('an event for a message the log never recorded is accepted and ignored', async () => {
  const response = await webhook({ email: 'someone@example.test', event: 'delivered', 'message-id': '<not-ours@relay>' });
  assert.equal(response.status, 200);
  assert.equal((await events()).length, 0);
});

test('a log write that fails never fails the send', async () => {
  await sql`drop table idoc.email_delivery_events, idoc.email_delivery_log cascade`;
  await assert.doesNotReject(sendTransactionalEmail({ html: '<p>x</p>', subject: 'S', to: 'resilient@example.test' }));
});

test('the retention job removes log rows older than 90 days with their events and keeps recent ones', async () => {
  await sql`insert into idoc.email_delivery_log(provider_message_id, recipient_email, recipient_domain, sent_at) values
    ('old@relay', 'a@example.test', 'example.test', now() - interval '91 days'), ('new@relay', 'b@example.test', 'example.test', now() - interval '5 days')`;
  await sql`insert into idoc.email_delivery_events(log_id, event, occurred_at) select id, 'delivered', now() from idoc.email_delivery_log`;
  const result = await purgeExpiredAuthRecords(new Date());
  assert.equal(result.emailDeliveryLog, 1);
  assert.deepEqual((await sql`select provider_message_id from idoc.email_delivery_log`).map((row) => row.provider_message_id), ['new@relay']);
  assert.equal((await events()).length, 1, 'the old row\'s event went with it');
});
