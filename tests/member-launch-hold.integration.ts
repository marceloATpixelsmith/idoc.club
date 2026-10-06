import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, beforeEach } from 'node:test';
import type Stripe from 'stripe';
import postgres from 'postgres';
import { sendTransactionalEmail } from '../lib/notifications/brevo-transactional.ts';
import { enqueueAuthSecurityNotification } from '../lib/notifications/auth-security-events.ts';
import { deliverNextAuthSecurityNotification } from '../lib/notifications/auth-security-delivery.ts';
import { enqueueRenewalNotices, deliverNextRenewalNotice, processRenewalNoticeBatch } from '../lib/notifications/renewal-notices.ts';
import { createMembershipCheckoutSession } from '../lib/payments/checkout.ts';
import { beginAutomaticRenewalSetup, disableAutomaticRenewal, cancelPendingRenewalChange } from '../lib/payments/renewal-preferences.ts';
import { refundMembershipPayment, refundSeminarRegistration, refundSeminarRegistrationCore } from '../lib/payments/refunds.ts';
import { cancelMemberSubscriptionAtPeriodEnd, createMembershipPortalSession } from '../lib/payments/stripe.ts';
import { createGuestSeminarCheckoutSession, createSeminarCheckoutSession } from '../lib/seminars/checkout.ts';
import { updateStripeCustomerEmail } from '../lib/payments/customer-email.ts';
import { processStripeEvent, type WebhookStripeClient } from '../lib/payments/webhook-handlers.ts';
import { processCanceledSeminarPayments } from '../lib/seminars/cancellation-worker.ts';
import { communicationHoldFields, MemberLaunchHoldError } from '../lib/runtime/member-launch-hold.ts';
import { closeHarness, createProfile, createUser, grantRole, resetIdoc, sql, testUrl } from './postgres-harness.ts';

const originalFetch = globalThis.fetch;
const originalHold = process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING;
let providerCalls = 0;
beforeEach(async () => {
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'true';
  (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
  process.env.VERCEL_ENV = 'development';
  process.env.STRIPE_SECRET_KEY = `sk_test_${'a'.repeat(24)}`;
  process.env.BREVO_API_KEY = 'test-only-provider-key';
  process.env.BREVO_FROM_EMAIL = 'accounts@example.test';
  providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; return Response.json({ messageId: 'synthetic' }, { status: 201 }); };
  await resetIdoc();
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (originalHold === undefined) delete process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING;
  else process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = originalHold;
  await closeHarness();
});

for (const value of ['true', undefined, '', 'invalid', 'false']) {
  test(`actual email provider boundary obeys ${JSON.stringify(value)}`, async () => {
    if (value === undefined) delete process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING;
    else process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = value;
    const send = sendTransactionalEmail({ html: '<p>synthetic</p>', subject: 'Synthetic', to: 'synthetic@example.test' });
    if (value === 'false') { await send; assert.equal(providerCalls, 1); }
    else { await assert.rejects(send, MemberLaunchHoldError); assert.equal(providerCalls, 0); }
  });
}

test('renewal scan suppresses communications while entitlement transitions continue', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source)
    values(${profile.id},'active','2025-01-01','2026-09-30','migration')`;
  const result = await enqueueRenewalNotices('2026-10-01');
  assert.equal(result.blocked, 1);
  assert.equal(result.nonRecurringGrace, 1);
  assert.equal(result.expirationReminders, 0);
  assert.equal((await sql`select count(*)::int count from idoc.notification_outbox`)[0].count, 0);
  assert.deepEqual(await deliverNextRenewalNotice(), { status: 'blocked' });
  assert.equal((await processRenewalNoticeBatch()).blocked, 1);
  assert.equal(providerCalls, 0);
});

test('new queued security work is terminal, consumes no retries, and never releases with the switch', async () => {
  const user = await createUser();
  await enqueueAuthSecurityNotification({ dedupeKey: 'hold-fixture', kind: 'password_changed', userId: user.id });
  const [job] = await sql`select * from idoc.auth_security_notification_outbox`;
  assert.equal(job.last_error_code, 'member_launch_hold');
  assert.ok(job.dead_lettered_at);
  assert.equal(job.attempt_count, 0);
  assert.equal(job.sent_at, null);
  assert.deepEqual(await deliverNextAuthSecurityNotification(), { status: 'blocked' });
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'false';
  assert.deepEqual(await deliverNextAuthSecurityNotification(), { status: 'empty' });
  assert.equal(providerCalls, 0);
});

test('held staging worker does not claim or alter a released deployment\'s shared queued work', async () => {
  const user = await createUser();
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'false';
  await enqueueAuthSecurityNotification({ dedupeKey: 'other-deployment', kind: 'password_changed', userId: user.id });
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'true';
  assert.deepEqual(await deliverNextAuthSecurityNotification(), { status: 'blocked' });
  const [job] = await sql`select * from idoc.auth_security_notification_outbox`;
  assert.equal(job.dead_lettered_at, null);
  assert.equal(job.lease_owner, null);
  assert.equal(job.attempt_count, 0);
});

test('all public live billing boundaries reject before provider or local billing writes', async () => {
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  delete process.env.VERCEL_ENV;
  process.env.STRIPE_SECRET_KEY = `sk_live_${'a'.repeat(24)}`;
  const operations = [
    () => createMembershipCheckoutSession('subscription'), () => beginAutomaticRenewalSetup(),
    () => disableAutomaticRenewal(), () => cancelPendingRenewalChange(),
    () => refundSeminarRegistrationCore(1, 'synthetic reason', null),
    () => refundMembershipPayment(1, 'synthetic reason'), () => refundSeminarRegistration(1, 'synthetic reason'),
    () => cancelMemberSubscriptionAtPeriodEnd('sub_synthetic'), () => createMembershipPortalSession(),
    () => createSeminarCheckoutSession(1), () => createGuestSeminarCheckoutSession(1),
    () => updateStripeCustomerEmail('cus_synthetic', 'synthetic@example.test'),
  ];
  for (const operation of operations) await assert.rejects(operation(), MemberLaunchHoldError);
  assert.equal(providerCalls, 0);
  assert.equal((await sql`select count(*)::int count from idoc.payment_refunds`)[0].count, 0);
});

async function renewalSetupEvent(livemode: boolean) {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await sql`insert into idoc.billing_accounts(profile_id,external_customer_id) values(${profile.id},'cus_synthetic')`;
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source)
    values(${profile.id},'active','2026-01-01','2027-01-01','migration')`;
  await sql`insert into idoc.renewal_preferences(profile_id,current_mode,pending_mode,effective_on,transition_state,external_checkout_session_id)
    values(${profile.id},'non_recurring','recurring','2027-01-01','awaiting_setup','cs_synthetic')`;
  return { id: 'evt_hold_synthetic', type: 'checkout.session.completed', livemode,
    data: { object: { id: 'cs_synthetic', mode: 'setup', customer: 'cus_synthetic', setup_intent: 'seti_synthetic',
      metadata: { kind: 'membership_renewal_setup', profileId: String(profile.id) } } } } as unknown as Stripe.Event;
}
function renewalStripe(): WebhookStripeClient {
  return {
    checkout: { sessions: { listLineItems: async () => ({ data: [] }) } },
    setupIntents: { retrieve: async () => ({ id: 'seti_synthetic', status: 'succeeded', usage: 'off_session', customer: 'cus_synthetic', payment_method: 'pm_synthetic' }) as Stripe.SetupIntent },
    paymentMethods: { retrieve: async () => ({ id: 'pm_synthetic', customer: 'cus_synthetic' }) as Stripe.PaymentMethod },
    prices: { create: async () => { providerCalls++; return { id: 'price_synthetic' } as Stripe.Price; } },
    subscriptionSchedules: { create: async () => { providerCalls++; return { id: 'sub_sched_synthetic' } as Stripe.SubscriptionSchedule; } },
  };
}
test('a live setup webhook cannot create a price or renewal schedule even with a configured test key', async () => {
  process.env.STRIPE_MEMBERSHIP_PRODUCT_ID = 'prod_synthetic_fixture';
  const event = await renewalSetupEvent(true);
  assert.equal(await processStripeEvent(event, renewalStripe()), 'blocked');
  assert.equal(providerCalls, 0);
  assert.equal((await sql`select transition_state from idoc.renewal_preferences`)[0].transition_state, 'failed');
  assert.equal((await sql`select count(*)::int count from idoc.reconciliation_findings`)[0].count, 1);
  assert.ok((await sql`select processed_at from idoc.stripe_events`)[0].processed_at);
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'false';
  assert.equal(await processStripeEvent(event, renewalStripe()), 'duplicate');
  assert.equal(providerCalls, 0);
});
test('sandbox renewal schedule creation remains usable under the communications hold', async () => {
  process.env.STRIPE_MEMBERSHIP_PRODUCT_ID = 'prod_synthetic_fixture';
  const event = await renewalSetupEvent(false);
  assert.equal(await processStripeEvent(event, renewalStripe()), 'processed');
  assert.equal(providerCalls, 2);
});

test('legacy news import and its transformations run idempotently during the hold without provider calls', async () => {
  const admin = await createUser();
  await grantRole(admin.id, 'super_admin');
  const completeSource = await readFile(new URL('../scripts/data-import/legacy-idoc-club-content-import.sql', import.meta.url), 'utf8');
  // Exercise the original executable news transformations. The later seminar section has an
  // independent, pre-existing INSERT column/value arity defect; see the launch runbook.
  const seminarSection = completeSource.lastIndexOf('--', completeSource.indexOf('INSERT INTO idoc.seminars'));
  const firstSeminarStatement = completeSource.lastIndexOf('WITH ins AS (', completeSource.indexOf('INSERT INTO idoc.seminars'));
  assert.ok(seminarSection > 0 && firstSeminarStatement > 0);
  const source = completeSource.slice(0, firstSeminarStatement) + '\nCOMMIT;';
  const connection = postgres(testUrl, { max: 1, onnotice: () => {} });
  try { await connection.unsafe(source); } finally { await connection.end(); }
  const first = await sql`select count(*)::int count from idoc.news_articles`;
  assert.ok(first[0].count > 0);
  const repeat = postgres(testUrl, { max: 1, onnotice: () => {} });
  try { await repeat.unsafe(source); } finally { await repeat.end(); }
  assert.equal((await sql`select count(*)::int count from idoc.news_articles`)[0].count, first[0].count);
  for (const table of ['billing_accounts', 'subscriptions', 'renewal_preferences', 'payments', 'notification_outbox']) {
    assert.equal((await sql.unsafe(`select count(*)::int count from idoc.${table}`))[0].count, 0, table);
  }
  assert.equal(providerCalls, 0);
  assert.equal(communicationHoldFields().lastErrorCode, 'member_launch_hold');
});

test('held invoice webhook preserves accounting/grace and permanently suppresses its payment email', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await sql`insert into idoc.billing_accounts(profile_id,external_customer_id) values(${profile.id},'cus_invoice_fixture')`;
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source)
    values(${profile.id},'active','2026-01-01','2026-10-01','migration')`;
  const event = { id: 'evt_invoice_hold', type: 'invoice.payment_failed', livemode: true,
    data: { object: { id: 'in_synthetic', customer: 'cus_invoice_fixture', period_start: 1790812800 } } } as unknown as Stripe.Event;
  assert.equal(await processStripeEvent(event, renewalStripe()), 'processed');
  const [job] = await sql`select sent_at,dead_lettered_at,last_error_code from idoc.notification_outbox`;
  assert.equal(job.sent_at, null);
  assert.ok(job.dead_lettered_at);
  assert.equal(job.last_error_code, 'member_launch_hold');
  assert.equal((await sql`select status from idoc.memberships`)[0].status, 'grace');
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'false';
  assert.deepEqual(await deliverNextRenewalNotice(), { status: 'empty' });
  assert.equal(await processStripeEvent(event, renewalStripe()), 'duplicate');
  assert.equal(providerCalls, 0);
});

test('live refund webhook records settlement but cannot cancel automatic renewal during the hold', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  const [payment] = await sql`insert into idoc.payments(profile_id,source,external_payment_id,amount_cents,currency,paid_at)
    values(${profile.id},'stripe_recurring','in_refund_synthetic',8000,'EUR',now()) returning id`;
  await sql`insert into idoc.payment_refunds(membership_payment_id,idempotency_key,external_refund_id,amount_cents,status,reason)
    values(${payment.id},'hold-refund-fixture','re_synthetic',8000,'pending','synthetic reason')`;
  await sql`insert into idoc.subscriptions(profile_id,external_subscription_id,price_id,status,current_period_end)
    values(${profile.id},'sub_synthetic','price_synthetic','active','2027-01-01')`;
  const event = { id: 'evt_refund_hold', type: 'refund.updated', livemode: true,
    data: { object: { id: 're_synthetic', status: 'succeeded', amount: 8000 } } } as unknown as Stripe.Event;
  const stripe = { ...renewalStripe(), subscriptions: { cancel: async () => { providerCalls++; } } };
  assert.equal(await processStripeEvent(event, stripe), 'blocked');
  assert.equal((await sql`select status from idoc.payment_refunds`)[0].status, 'succeeded');
  assert.equal((await sql`select status from idoc.subscriptions`)[0].status, 'active');
  assert.equal(providerCalls, 0);
});

test('held live seminar cancellation worker stops without retry or reconciliation storms', async () => {
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  delete process.env.VERCEL_ENV;
  process.env.STRIPE_SECRET_KEY = `sk_live_${'a'.repeat(24)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.deepEqual(await processCanceledSeminarPayments(), { blocked: 1, processed: 0 });
  }
  assert.equal((await sql`select count(*)::int count from idoc.reconciliation_findings`)[0].count, 0);
  assert.equal(providerCalls, 0);
});
