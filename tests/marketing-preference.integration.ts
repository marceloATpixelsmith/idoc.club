import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, afterEach, beforeEach } from 'node:test';
import { closeHarness, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';
import { POST as webhookPost } from '../app/api/mailchimp/webhook/route.ts';
import { changeMarketingPreference, getMarketingPreference, reconcileMarketingPreferences, settleOnboardingMarketingOptIn } from '../lib/membership/marketing-preference.ts';

const originalFetch = globalThis.fetch;
const WEBHOOK_KEY = 'mailchimp-route-test-key';
let mailchimp: Record<string, string>;
let calls: { body?: Record<string, unknown>; method: string; url: string }[];

beforeEach(async () => {
  await resetIdoc();
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'false';
  process.env.MAILCHIMP_MARKETING_API_KEY = 'test-api-key';
  process.env.MAILCHIMP_MARKETING_AUDIENCE_ID = 'audience';
  process.env.MAILCHIMP_MARKETING_SERVER_PREFIX = 'us1';
  process.env.MAILCHIMP_WEBHOOK_KEY = WEBHOOK_KEY;
  // email -> Mailchimp status; absent means "never on the list".
  mailchimp = {};
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ body, method, url });
    const parsed = new URL(url);
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });
    if (parsed.pathname.endsWith('/members') && method === 'GET') {
      const status = parsed.searchParams.get('status');
      return json({ members: Object.entries(mailchimp).filter(([, value]) => value === status).map(([email]) => ({ email_address: email })) });
    }
    const emailFor = (hash: string) => Object.keys(mailchimp).find((email) => hashOf(email) === hash);
    const hash = parsed.pathname.split('/').at(-1) ?? '';
    const known = emailFor(hash);
    if (method === 'GET') return known ? json({ status: mailchimp[known] }) : json({}, 404);
    if (method === 'PATCH') return known ? (mailchimp[known] = String(body?.status), json({})) : json({}, 404);
    if (method === 'PUT') {
      const email = String(body?.email_address);
      if (body?.status === 'subscribed' && mailchimp[email] === 'unsubscribed') return json({ title: 'Member In Compliance State' }, 400);
      mailchimp[email] = String(body?.status);
      return json({ status: mailchimp[email] });
    }
    return json({}, 500);
  }) as typeof fetch;
});

afterEach(() => { globalThis.fetch = originalFetch; });
after(closeHarness);

function hashOf(email: string) {
  return createHash('md5').update(email).digest('hex');
}

async function member(optIn: boolean, extra: { pendingAt?: Date } = {}) {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await sql`insert into idoc.onboarding_consents(profile_id,terms_accepted_at,privacy_accepted_at,keep_updated_opt_in,keep_updated_pending_at)
    values(${profile.id}, now(), now(), ${optIn}, ${extra.pendingAt?.toISOString() ?? null})`;
  return { email: user.email, profileId: profile.id, userId: user.id };
}

function webhookRequest(fields: Record<string, string>, key = WEBHOOK_KEY) {
  return new Request(`https://idoc.club/api/mailchimp/webhook?key=${key}`, {
    body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
}

const event = (type: string, email: string) => ({ type, 'data[email]': email, 'data[list_id]': 'audience' });

test('a Mailchimp unsubscribe webhook clears the member\'s keep-updated flag and records an audit entry', async () => {
  const subject = await member(true);
  const bystander = await member(true);
  const response = await webhookPost(webhookRequest(event('unsubscribe', subject.email.toUpperCase())));
  assert.equal(response.status, 200);
  const preference = await getMarketingPreference(subject.profileId);
  assert.deepEqual({ optIn: preference?.optIn, pending: preference?.pending, source: preference?.source }, { optIn: false, pending: false, source: 'mailchimp_webhook' });
  assert.equal((await getMarketingPreference(bystander.profileId))?.optIn, true);
  const audit = await sql`select action, entity_id from idoc.audit_log where action='member.marketing_preference.changed'`;
  assert.deepEqual(audit.map((row) => row.entity_id), [String(subject.profileId)]);
});

test('a cleaned webhook clears the flag, and a replayed unsubscribe is a no-op', async () => {
  const subject = await member(true);
  await webhookPost(webhookRequest(event('cleaned', subject.email)));
  assert.equal((await getMarketingPreference(subject.profileId))?.optIn, false);
  await webhookPost(webhookRequest(event('unsubscribe', subject.email)));
  assert.equal((await sql`select count(*)::int as n from idoc.audit_log where action='member.marketing_preference.changed'`)[0].n, 1);
});

test('a subscribe webhook only completes an opt-in that was waiting on confirmation', async () => {
  const waiting = await member(false, { pendingAt: new Date() });
  const choseOptOut = await member(false);
  await webhookPost(webhookRequest(event('subscribe', waiting.email)));
  await webhookPost(webhookRequest(event('subscribe', choseOptOut.email)));
  const confirmed = await getMarketingPreference(waiting.profileId);
  assert.deepEqual({ optIn: confirmed?.optIn, pending: confirmed?.pending }, { optIn: true, pending: false });
  assert.equal((await getMarketingPreference(choseOptOut.profileId))?.optIn, false);
});

test('the webhook rejects a wrong key, an unconfigured key and another audience, and ignores unknown addresses and event types', async () => {
  const subject = await member(true);
  assert.equal((await webhookPost(webhookRequest(event('unsubscribe', subject.email), 'wrong-key'))).status, 400);
  assert.equal((await webhookPost(webhookRequest({ ...event('unsubscribe', subject.email), 'data[list_id]': 'other-audience' }))).status, 200);
  assert.equal((await webhookPost(webhookRequest(event('profile', subject.email)))).status, 200);
  assert.equal((await webhookPost(webhookRequest(event('unsubscribe', 'nobody@example.test')))).status, 200);
  assert.equal((await getMarketingPreference(subject.profileId))?.optIn, true);
  delete process.env.MAILCHIMP_WEBHOOK_KEY;
  assert.equal((await webhookPost(webhookRequest(event('unsubscribe', subject.email)))).status, 503);
  assert.equal((await getMarketingPreference(subject.profileId))?.optIn, true);
});

test('webhook processing never contacts Mailchimp and leaves transactional tables alone', async () => {
  const subject = await member(true);
  await webhookPost(webhookRequest(event('unsubscribe', subject.email)));
  assert.equal(calls.length, 0);
  assert.equal((await sql`select count(*)::int as n from idoc.account_delivery_outbox`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from idoc.notification_outbox`)[0].n, 0);
  assert.equal((await sql`select account_state from idoc.users where id=${subject.userId}`)[0].account_state, 'active');
});

test('reconciliation backfills everyone already unsubscribed or cleaned in Mailchimp, without re-subscribing anyone', async () => {
  const unsubscribed = await member(true);
  const cleaned = await member(true);
  const staying = await member(true);
  const alreadyOptedOut = await member(false);
  mailchimp = { [unsubscribed.email]: 'unsubscribed', [cleaned.email]: 'cleaned', [staying.email]: 'subscribed', [alreadyOptedOut.email]: 'subscribed', 'stranger@example.test': 'unsubscribed' };
  const summary = await reconcileMarketingPreferences();
  assert.deepEqual({ bounced: summary.bounced, optedOut: summary.optedOut }, { bounced: 1, optedOut: 1 });
  assert.equal((await getMarketingPreference(unsubscribed.profileId))?.optIn, false);
  assert.equal((await getMarketingPreference(cleaned.profileId))?.optIn, false);
  assert.equal((await getMarketingPreference(staying.profileId))?.optIn, true);
  assert.equal((await getMarketingPreference(alreadyOptedOut.profileId))?.optIn, false);
  assert.ok(calls.every(({ method }) => method === 'GET'), 'reconciliation only reads from Mailchimp');
});

test('reconciliation completes an opt-in once the confirmation email was clicked, and fails loudly when Mailchimp is unreadable', async () => {
  const waiting = await member(false, { pendingAt: new Date() });
  mailchimp = { [waiting.email]: 'subscribed' };
  assert.equal((await reconcileMarketingPreferences()).confirmed, 1);
  assert.equal((await getMarketingPreference(waiting.profileId))?.optIn, true);
  globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
  await assert.rejects(reconcileMarketingPreferences());
});

test('opting out is saved locally and pushed to Mailchimp; if Mailchimp is down the choice is still honored', async () => {
  const subject = await member(true);
  mailchimp = { [subject.email]: 'subscribed' };
  const result = await changeMarketingPreference({ actorId: subject.userId, desired: false, profileId: subject.profileId, source: 'member' });
  assert.deepEqual(result, { status: 'opted_out', synced: true });
  assert.equal(mailchimp[subject.email], 'unsubscribed');
  assert.equal((await getMarketingPreference(subject.profileId))?.optIn, false);

  const second = await member(true);
  globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
  assert.deepEqual(await changeMarketingPreference({ actorId: second.userId, desired: false, profileId: second.profileId, source: 'member' }), { status: 'opted_out', synced: false });
  assert.equal((await getMarketingPreference(second.profileId))?.optIn, false);
});

test('opting in after a self-unsubscribe waits for the confirmation email instead of claiming a subscription', async () => {
  const subject = await member(false);
  mailchimp = { [subject.email]: 'unsubscribed' };
  const result = await changeMarketingPreference({ actorId: subject.userId, desired: true, profileId: subject.profileId, source: 'member' });
  assert.equal(result.status, 'pending');
  const waiting = await getMarketingPreference(subject.profileId);
  assert.deepEqual({ optIn: waiting?.optIn, pending: waiting?.pending, source: waiting?.source }, { optIn: false, pending: true, source: 'member' });
  assert.equal(mailchimp[subject.email], 'pending');
  // Turning it back off while waiting cancels the pending opt-in.
  await changeMarketingPreference({ actorId: subject.userId, desired: false, profileId: subject.profileId, source: 'member' });
  assert.equal((await getMarketingPreference(subject.profileId))?.pending, false);
  assert.equal(mailchimp[subject.email], 'unsubscribed');
});

test('opting in for a member who was never on the list subscribes immediately; provider problems change nothing', async () => {
  const subject = await member(false);
  assert.equal((await changeMarketingPreference({ actorId: subject.userId, desired: true, profileId: subject.profileId, source: 'member' })).status, 'opted_in');
  assert.equal((await getMarketingPreference(subject.profileId))?.optIn, true);

  const down = await member(false);
  globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
  assert.equal((await changeMarketingPreference({ actorId: down.userId, desired: true, profileId: down.profileId, source: 'member' })).status, 'failed');
  assert.equal((await getMarketingPreference(down.profileId))?.optIn, false);

  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'true';
  assert.equal((await changeMarketingPreference({ actorId: down.userId, desired: true, profileId: down.profileId, source: 'member' })).status, 'blocked');
  assert.equal((await getMarketingPreference(down.profileId))?.optIn, false);
});

test('an administrator switch-off is attributed to the administrator and carries the reason', async () => {
  const subject = await member(true);
  const admin = await createUser();
  mailchimp = { [subject.email]: 'subscribed' };
  await changeMarketingPreference({ actorId: admin.id, desired: false, profileId: subject.profileId, reason: 'Member asked by phone', source: 'admin' });
  const [audit] = await sql`select actor_id, reason from idoc.audit_log where action='member.marketing_preference.changed'`;
  assert.deepEqual({ actor: audit.actor_id, reason: audit.reason }, { actor: admin.id, reason: 'Member asked by phone' });
  assert.equal((await getMarketingPreference(subject.profileId))?.source, 'admin');
});

test('a member without an onboarding consent record is left alone', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  assert.deepEqual(await changeMarketingPreference({ actorId: user.id, desired: false, profileId: profile.id, source: 'member' }), { status: 'no_consent_record', synced: false });
  assert.equal(await getMarketingPreference(profile.id), null);
});

test('onboarding corrects the stored flag when Mailchimp needs confirmation, and never throws', async () => {
  const resubscribing = await member(true);
  mailchimp = { [resubscribing.email]: 'unsubscribed' };
  await settleOnboardingMarketingOptIn(resubscribing.profileId, resubscribing.email);
  const pending = await getMarketingPreference(resubscribing.profileId);
  assert.deepEqual({ optIn: pending?.optIn, pending: pending?.pending }, { optIn: false, pending: true });

  const fresh = await member(true);
  await settleOnboardingMarketingOptIn(fresh.profileId, fresh.email);
  assert.equal((await getMarketingPreference(fresh.profileId))?.optIn, true);

  globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
  await settleOnboardingMarketingOptIn(fresh.profileId, fresh.email);
});
