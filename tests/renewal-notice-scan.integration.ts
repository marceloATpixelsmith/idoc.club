import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { isEntitled } from '../lib/membership/entitlement.ts';
import { enqueueRenewalNotices } from '../lib/notifications/renewal-notices.ts';
import { AUTO_RENEWAL_NOTICE_DAYS, GRACE_REMINDER_DAYS_BEFORE_END, NON_RENEWAL_EXPIRATION_NOTICE_DAYS } from '../lib/payments/renewal.ts';
import { processStripeEvent } from '../lib/payments/webhook-handlers.ts';
import { closeHarness, concurrently, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function fixtureProfile() {
  const user = await createUser();
  const profile = await createProfile(user.id);
  return { profile, user };
}

test('the renewal reminder fires on and inside the 15-day window and not just outside it', async () => {
  const cases: Array<[number, boolean]> = [
    [AUTO_RENEWAL_NOTICE_DAYS - 1, true],
    [AUTO_RENEWAL_NOTICE_DAYS, true],
    [AUTO_RENEWAL_NOTICE_DAYS + 1, false],
  ];
  for (const [offset, shouldFire] of cases) {
    await resetIdoc();
    const { profile } = await fixtureProfile();
    await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
      values(${profile.id}, ${`sub_offset_${offset}`}, 'price_fixture', 'active', ${isoDate(offset)}, false)`;
    const summary = await enqueueRenewalNotices();
    assert.equal(summary.renewalReminders, shouldFire ? 1 : 0, `offset ${offset} days`);
  }
});

test('the renewal reminder excludes a cancelling subscription and a past-due subscription', async () => {
  const cancelling = await fixtureProfile();
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values(${cancelling.profile.id}, 'sub_cancelling', 'price_fixture', 'active', ${isoDate(AUTO_RENEWAL_NOTICE_DAYS)}, true)`;
  const pastDue = await fixtureProfile();
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values(${pastDue.profile.id}, 'sub_past_due', 'price_fixture', 'past_due', ${isoDate(AUTO_RENEWAL_NOTICE_DAYS)}, false)`;
  const summary = await enqueueRenewalNotices();
  assert.equal(summary.renewalReminders, 0);
});

test('the expiration reminder includes every non-auto-renewing member and excludes anyone still auto-billing', async () => {
  const validUntil = isoDate(NON_RENEWAL_EXPIRATION_NOTICE_DAYS);

  const noSubscription = await fixtureProfile();
  await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source) values(${noSubscription.profile.id}, 'active', '2025-01-01', ${validUntil}, 'manual')`;

  const canceledSubscription = await fixtureProfile();
  await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source) values(${canceledSubscription.profile.id}, 'active', '2025-01-01', ${validUntil}, 'stripe')`;
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values(${canceledSubscription.profile.id}, 'sub_canceled_expiry', 'price_fixture', 'canceled', ${validUntil}, false)`;

  const cancellingSubscription = await fixtureProfile();
  await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source) values(${cancellingSubscription.profile.id}, 'active', '2025-01-01', ${validUntil}, 'stripe')`;
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values(${cancellingSubscription.profile.id}, 'sub_cancelling_expiry', 'price_fixture', 'active', ${validUntil}, true)`;

  const openSubscription = await fixtureProfile();
  await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source) values(${openSubscription.profile.id}, 'active', '2025-01-01', ${validUntil}, 'stripe')`;
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values(${openSubscription.profile.id}, 'sub_open_expiry', 'price_fixture', 'active', ${validUntil}, false)`;

  const summary = await enqueueRenewalNotices();
  assert.equal(summary.expirationReminders, 3);
  const rows = await sql`select profile_id from idoc.notification_outbox where kind='membership.expiration_reminder'`;
  const included = rows.map((row) => row.profile_id as number).sort((left, right) => left - right);
  assert.deepEqual(included, [noSubscription.profile.id, canceledSubscription.profile.id, cancellingSubscription.profile.id].sort((left, right) => left - right));
  assert.equal(included.includes(openSubscription.profile.id), false);
});

test('the grace reminder fires within its window and stops once the grace period has ended', async () => {
  const withinWindow = await fixtureProfile();
  await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source) values(${withinWindow.profile.id}, 'grace', '2025-01-01', ${isoDate(GRACE_REMINDER_DAYS_BEFORE_END)}, 'stripe')`;
  const alreadyEnded = await fixtureProfile();
  await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source) values(${alreadyEnded.profile.id}, 'grace', '2025-01-01', ${isoDate(-1)}, 'stripe')`;

  const summary = await enqueueRenewalNotices();
  assert.equal(summary.graceReminders, 1);
  const [reminder] = await sql`select profile_id from idoc.notification_outbox where kind='membership.grace_reminder'`;
  assert.equal(reminder.profile_id, withinWindow.profile.id);
  // The already-ended row falls out of the reminder window and into the expiry transition instead.
  assert.equal(summary.graceExpired, 1);
});

test('grace-expired transitions the membership to expired, enqueues exactly one notice, and a re-run does not duplicate', async () => {
  const { profile } = await fixtureProfile();
  const graceEnd = isoDate(-1);
  await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source) values(${profile.id}, 'grace', '2025-01-01', ${graceEnd}, 'stripe')`;

  const first = await enqueueRenewalNotices();
  assert.equal(first.graceExpired, 1);
  const [membership] = await sql`select status, valid_until from idoc.memberships where profile_id=${profile.id}`;
  assert.equal(membership.status, 'expired');
  assert.equal(isEntitled({ status: membership.status, validUntil: membership.valid_until }, isoDate(0)), false);
  const [notice] = await sql`select payload, dedupe_key from idoc.notification_outbox where kind='membership.grace_expired' and profile_id=${profile.id}`;
  assert.equal(notice.dedupe_key, `membership.grace_expired:${profile.id}:${graceEnd}`);

  const second = await enqueueRenewalNotices();
  assert.equal(second.graceExpired, 0);
  assert.equal((await sql`select count(*)::int as count from idoc.notification_outbox where kind='membership.grace_expired' and profile_id=${profile.id}`)[0].count, 1);
});

test('two overlapping grace-expiry scans on the same row produce exactly one transition and one notice', async () => {
  const { profile } = await fixtureProfile();
  const graceEnd = isoDate(-1);
  await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source) values(${profile.id}, 'grace', '2025-01-01', ${graceEnd}, 'stripe')`;

  const [left, right] = await concurrently(() => enqueueRenewalNotices(), () => enqueueRenewalNotices());
  const total = [left, right].reduce((sum, outcome) => sum + (outcome.status === 'fulfilled' ? outcome.value.graceExpired : 0), 0);
  assert.equal(total, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.notification_outbox where kind='membership.grace_expired' and profile_id=${profile.id}`)[0].count, 1);
  assert.equal((await sql`select status from idoc.memberships where profile_id=${profile.id}`)[0].status, 'expired');
});

test('a grace-expiry scan racing a same-day invoice.paid converges to active with the correctly extended validUntil', async () => {
  const { profile } = await fixtureProfile();
  const customerId = 'cus_grace_race_fixture';
  await sql`insert into idoc.billing_accounts(profile_id, external_customer_id) values(${profile.id}, ${customerId})`;
  const graceEnd = isoDate(0);
  await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source) values(${profile.id}, 'grace', '2025-01-01', ${graceEnd}, 'stripe')`;

  const paidEvent = {
    api_version: '2025-04-30.basil', created: Math.floor(Date.now() / 1000),
    data: { object: { amount_paid: 8000, currency: 'eur', customer: customerId, id: 'in_grace_race_fixture', status_transitions: { paid_at: Math.floor(Date.now() / 1000) } } },
    id: `evt_${randomUUID()}`, livemode: false, object: 'event', pending_webhooks: 0, request: { id: null, idempotency_key: null }, type: 'invoice.paid',
  };
  const fakeStripe = { checkout: { sessions: { listLineItems: async () => ({ data: [] }) } } };

  await concurrently(() => enqueueRenewalNotices(), () => processStripeEvent(paidEvent as any, fakeStripe));

  const [membership] = await sql`select status, valid_until from idoc.memberships where profile_id=${profile.id}`;
  assert.equal(membership.status, 'active');
  const expected = new Date(graceEnd);
  expected.setUTCFullYear(expected.getUTCFullYear() + 1);
  assert.equal(membership.valid_until, expected.toISOString().slice(0, 10));
});
