import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { POST } from '../app/api/stripe/webhook/route.ts';
import { getStripeServerClient } from '../lib/payments/stripe-client.ts';
import { processStripeEvent } from '../lib/payments/webhook-handlers.ts';
import {
  closeHarness, createMembership, createProfile, createUser, resetIdoc, sql,
} from './postgres-harness.ts';

const WEBHOOK_SECRET = 'whsec_fixture_only_signing_secret_for_tests';

beforeEach(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture0000000000000000';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_ONE_TIME_PRODUCT_ID = 'prod_one_time_fixture';
  process.env.STRIPE_RECURRING_PRODUCT_ID = 'prod_recurring_fixture';
  await resetIdoc();
});
after(closeHarness);

// checkout.session.completed's handler verifies the session's line item against the configured
// Product via stripe.checkout.sessions.listLineItems — a real network call the real Stripe client
// would make, which this sandbox cannot reach. Tests that need the handler to actually reach that
// verification call processStripeEvent directly with this fake instead of going through POST().
function fakeLineItemsClient(product: string | null, priceId = 'price_line_item_fixture') {
  return { checkout: { sessions: { listLineItems: async () => ({ data: product ? [{ price: { id: priceId, product } }] : [] }) } } };
}

function fixtureEvent(type: string, object: Record<string, unknown>, id = `evt_${randomUUID()}`) {
  return {
    api_version: '2025-04-30.basil', created: Math.floor(Date.now() / 1000), data: { object },
    id, livemode: false, object: 'event', pending_webhooks: 0,
    request: { id: null, idempotency_key: null }, type,
  };
}

async function postWebhook(event: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const signature = getStripeServerClient().webhooks.generateTestHeaderString({ payload, secret });
  return POST(new Request('https://idoc.club/api/stripe/webhook', {
    body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': signature }, method: 'POST',
  }));
}

async function billedProfile(customerId: string) {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await sql`insert into idoc.billing_accounts(profile_id, external_customer_id) values(${profile.id}, ${customerId})`;
  return profile;
}

function subscriptionObject(overrides: Record<string, unknown> = {}) {
  return {
    cancel_at_period_end: false, customer: 'cus_fixture', id: 'sub_fixture',
    items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, price: { id: 'price_annual_fixture' } }] },
    status: 'active', ...overrides,
  };
}

test('a signature that does not match the configured secret is rejected before any database access', async () => {
  const response = await postWebhook(fixtureEvent('customer.subscription.created', subscriptionObject()), 'whsec_wrong_secret_value_entirely');
  assert.equal(response.status, 400);
  assert.equal((await sql`select count(*)::int as count from idoc.stripe_events`)[0].count, 0);
});

test('customer.subscription.created creates a subscription row for the matching billing account', async () => {
  const profile = await billedProfile('cus_created_fixture');
  const response = await postWebhook(fixtureEvent('customer.subscription.created', subscriptionObject({ customer: 'cus_created_fixture', id: 'sub_created_fixture' })));
  assert.equal(response.status, 200);
  const [row] = await sql`select profile_id, price_id, status, cancel_at_period_end from idoc.subscriptions where external_subscription_id='sub_created_fixture'`;
  assert.equal(row.profile_id, profile.id);
  assert.equal(row.price_id, 'price_annual_fixture');
  assert.equal(row.status, 'active');
  assert.equal(row.cancel_at_period_end, false);
});

test('customer.subscription.created for an unrecognized customer is safely ignored, inventing no profile', async () => {
  const response = await postWebhook(fixtureEvent('customer.subscription.created', subscriptionObject({ customer: 'cus_unknown_to_us' })));
  assert.equal(response.status, 200);
  assert.equal((await sql`select count(*)::int as count from idoc.subscriptions`)[0].count, 0);
});

test('customer.subscription.updated refreshes status, period, cancel flag, and price on the existing row', async () => {
  const profile = await billedProfile('cus_updated_fixture');
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values(${profile.id}, 'sub_updated_fixture', 'price_annual_fixture', 'active', current_date, false)`;
  const response = await postWebhook(fixtureEvent('customer.subscription.updated', subscriptionObject({
    cancel_at_period_end: true, customer: 'cus_updated_fixture', id: 'sub_updated_fixture', status: 'past_due',
    items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 60 * 24 * 3600, price: { id: 'price_annual_fixture_v2' } }] },
  })));
  assert.equal(response.status, 200);
  const [row] = await sql`select price_id, status, cancel_at_period_end from idoc.subscriptions where external_subscription_id='sub_updated_fixture'`;
  assert.equal(row.status, 'past_due');
  assert.equal(row.cancel_at_period_end, true);
  assert.equal(row.price_id, 'price_annual_fixture_v2');
});

test('customer.subscription.deleted marks the subscription ended without touching membership access', async () => {
  const profile = await billedProfile('cus_deleted_fixture');
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values(${profile.id}, 'sub_deleted_fixture', 'price_annual_fixture', 'active', current_date, false)`;
  const membership = await createMembership(profile.id);
  const response = await postWebhook(fixtureEvent('customer.subscription.deleted', subscriptionObject({ customer: 'cus_deleted_fixture', id: 'sub_deleted_fixture', status: 'canceled' })));
  assert.equal(response.status, 200);
  assert.equal((await sql`select status from idoc.subscriptions where external_subscription_id='sub_deleted_fixture'`)[0].status, 'canceled');
  const [after] = await sql`select status, valid_until from idoc.memberships where id=${membership.id}`;
  assert.equal(after.status, 'active');
});

test('invoice.paid records a payment and extends an early renewal by 12 months from the current paid-through date', async () => {
  const profile = await billedProfile('cus_invoice_early');
  const membership = await createMembership(profile.id);
  const [before] = await sql`select valid_until from idoc.memberships where id=${membership.id}`;
  const paidAtSeconds = Math.floor(Date.now() / 1000);
  const response = await postWebhook(fixtureEvent('invoice.paid', {
    amount_paid: 8000, currency: 'eur', customer: 'cus_invoice_early', id: 'in_early_fixture',
    status_transitions: { paid_at: paidAtSeconds },
  }));
  assert.equal(response.status, 200);
  const [payment] = await sql`select source, amount_cents, currency, profile_id from idoc.payments where external_payment_id='in_early_fixture'`;
  assert.equal(payment.source, 'stripe_recurring');
  assert.equal(payment.amount_cents, 8000);
  assert.equal(payment.currency, 'EUR');
  assert.equal(payment.profile_id, profile.id);
  const [after] = await sql`select status, valid_until from idoc.memberships where id=${membership.id}`;
  assert.equal(after.status, 'active');
  const expected = new Date(before.valid_until);
  expected.setUTCFullYear(expected.getUTCFullYear() + 1);
  assert.equal(after.valid_until, expected.toISOString().slice(0, 10));
});

test('invoice.paid starts a fresh 12-month term from the payment date when the prior membership already expired', async () => {
  const profile = await billedProfile('cus_invoice_expired');
  await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source) values(${profile.id}, 'expired', '2024-01-01', '2025-01-01', 'migration')`;
  const paidAt = new Date();
  const response = await postWebhook(fixtureEvent('invoice.paid', {
    amount_paid: 8000, currency: 'eur', customer: 'cus_invoice_expired', id: 'in_expired_fixture',
    status_transitions: { paid_at: Math.floor(paidAt.getTime() / 1000) },
  }));
  assert.equal(response.status, 200);
  const [after] = await sql`select status, valid_until from idoc.memberships where profile_id=${profile.id}`;
  assert.equal(after.status, 'active');
  const expected = new Date(paidAt);
  expected.setUTCFullYear(expected.getUTCFullYear() + 1);
  assert.equal(after.valid_until, expected.toISOString().slice(0, 10));
});

test('invoice.payment_failed puts the membership into a five-day grace period and records no payment', async () => {
  const profile = await billedProfile('cus_invoice_failed');
  const membership = await createMembership(profile.id);
  const response = await postWebhook(fixtureEvent('invoice.payment_failed', { customer: 'cus_invoice_failed', id: 'in_failed_fixture' }));
  assert.equal(response.status, 200);
  assert.equal((await sql`select count(*)::int as count from idoc.payments`)[0].count, 0);
  const [after] = await sql`select status, valid_until from idoc.memberships where id=${membership.id}`;
  assert.equal(after.status, 'grace');
  const expected = new Date();
  expected.setUTCDate(expected.getUTCDate() + 5);
  assert.equal(after.valid_until, expected.toISOString().slice(0, 10));
});

test('invoice.payment_action_required changes no entitlement state', async () => {
  const profile = await billedProfile('cus_invoice_action_required');
  const membership = await createMembership(profile.id);
  const [before] = await sql`select status, valid_until from idoc.memberships where id=${membership.id}`;
  const response = await postWebhook(fixtureEvent('invoice.payment_action_required', { customer: 'cus_invoice_action_required', id: 'in_action_required_fixture' }));
  assert.equal(response.status, 200);
  const [after] = await sql`select status, valid_until from idoc.memberships where id=${membership.id}`;
  assert.deepEqual(after, before);
});

test('checkout.session.completed in payment mode records a one-time payment and extends membership using server-set metadata, never trusting a client-supplied profile id directly', async () => {
  const profile = await billedProfile('cus_checkout_fixture');
  const membership = await createMembership(profile.id);
  const event = fixtureEvent('checkout.session.completed', {
    amount_total: 8000, currency: 'eur', customer: 'cus_checkout_fixture', id: 'cs_fixture',
    metadata: { profileId: String(profile.id) }, mode: 'payment', payment_intent: 'pi_fixture', payment_status: 'paid',
  });
  const outcome = await processStripeEvent(event as any, fakeLineItemsClient('prod_one_time_fixture'));
  assert.equal(outcome, 'processed');
  const [payment] = await sql`select source, amount_cents, profile_id, reference from idoc.payments where external_payment_id='pi_fixture'`;
  assert.equal(payment.source, 'stripe_one_time');
  assert.equal(payment.amount_cents, 8000);
  assert.equal(payment.profile_id, profile.id);
  assert.match(payment.reference, /cs_fixture/);
  assert.match(payment.reference, /price_line_item_fixture/);
  const [after] = await sql`select status from idoc.memberships where id=${membership.id}`;
  assert.equal(after.status, 'active');
});

test('checkout.session.completed whose line item was priced against a different Stripe Product is rejected even when the amount and currency match', async () => {
  const profile = await billedProfile('cus_checkout_wrong_product');
  await createMembership(profile.id);
  const event = fixtureEvent('checkout.session.completed', {
    amount_total: 8000, currency: 'eur', customer: 'cus_checkout_wrong_product', id: 'cs_wrong_product_fixture',
    metadata: { profileId: String(profile.id) }, mode: 'payment', payment_intent: 'pi_wrong_product_fixture', payment_status: 'paid',
  });
  const outcome = await processStripeEvent(event as any, fakeLineItemsClient('prod_unexpected'));
  assert.equal(outcome, 'processed');
  assert.equal((await sql`select count(*)::int as count from idoc.payments where external_payment_id='pi_wrong_product_fixture'`)[0].count, 0);
});

test('checkout.session.completed with no line items at all is rejected rather than trusting the amount/currency alone', async () => {
  const profile = await billedProfile('cus_checkout_no_line_items');
  await createMembership(profile.id);
  const event = fixtureEvent('checkout.session.completed', {
    amount_total: 8000, currency: 'eur', customer: 'cus_checkout_no_line_items', id: 'cs_no_line_items_fixture',
    metadata: { profileId: String(profile.id) }, mode: 'payment', payment_intent: 'pi_no_line_items_fixture', payment_status: 'paid',
  });
  const outcome = await processStripeEvent(event as any, fakeLineItemsClient(null));
  assert.equal(outcome, 'processed');
  assert.equal((await sql`select count(*)::int as count from idoc.payments where external_payment_id='pi_no_line_items_fixture'`)[0].count, 0);
});

test('checkout.session.completed in subscription mode or with an unpaid status is ignored, since invoice.paid handles the recurring path', async () => {
  const profile = await billedProfile('cus_checkout_subscription_mode');
  await createMembership(profile.id);
  await postWebhook(fixtureEvent('checkout.session.completed', {
    amount_total: 8000, currency: 'eur', customer: 'cus_checkout_subscription_mode', id: 'cs_subscription_fixture',
    metadata: { profileId: String(profile.id) }, mode: 'subscription', payment_intent: 'pi_subscription_fixture', payment_status: 'paid',
  }));
  await postWebhook(fixtureEvent('checkout.session.completed', {
    amount_total: 8000, currency: 'eur', customer: 'cus_checkout_subscription_mode', id: 'cs_unpaid_fixture',
    metadata: { profileId: String(profile.id) }, mode: 'payment', payment_intent: 'pi_unpaid_fixture', payment_status: 'unpaid',
  }));
  assert.equal((await sql`select count(*)::int as count from idoc.payments`)[0].count, 0);
});

test('checkout.session.completed with an amount or currency other than the expected €80 fee is rejected', async () => {
  const profile = await billedProfile('cus_checkout_wrong_amount');
  await createMembership(profile.id);
  await postWebhook(fixtureEvent('checkout.session.completed', {
    amount_total: 1000, currency: 'eur', customer: 'cus_checkout_wrong_amount', id: 'cs_wrong_amount_fixture',
    metadata: { profileId: String(profile.id) }, mode: 'payment', payment_intent: 'pi_wrong_amount_fixture', payment_status: 'paid',
  }));
  await postWebhook(fixtureEvent('checkout.session.completed', {
    amount_total: 8000, currency: 'usd', customer: 'cus_checkout_wrong_amount', id: 'cs_wrong_currency_fixture',
    metadata: { profileId: String(profile.id) }, mode: 'payment', payment_intent: 'pi_wrong_currency_fixture', payment_status: 'paid',
  }));
  assert.equal((await sql`select count(*)::int as count from idoc.payments`)[0].count, 0);
});

test('payment_intent.succeeded is acknowledged but takes no action, since checkout.session.completed is the authoritative recorder', async () => {
  const profile = await billedProfile('cus_payment_intent_fixture');
  await createMembership(profile.id);
  const response = await postWebhook(fixtureEvent('payment_intent.succeeded', { customer: 'cus_payment_intent_fixture', id: 'pi_standalone_fixture', status: 'succeeded' }));
  assert.equal(response.status, 200);
  assert.equal((await sql`select count(*)::int as count from idoc.payments`)[0].count, 0);
  assert.equal((await sql`select processed_at is not null as processed from idoc.stripe_events where event_type='payment_intent.succeeded'`)[0].processed, true);
});

test('a replayed event id is a no-op the second time, never double-crediting a payment', async () => {
  const profile = await billedProfile('cus_replay_fixture');
  const membership = await createMembership(profile.id);
  const [before] = await sql`select valid_until from idoc.memberships where id=${membership.id}`;
  const event = fixtureEvent('invoice.paid', {
    amount_paid: 8000, currency: 'eur', customer: 'cus_replay_fixture', id: 'in_replay_fixture',
    status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
  }, 'evt_replay_fixture');
  const first = await postWebhook(event);
  const second = await postWebhook(event);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await sql`select count(*)::int as count from idoc.payments where external_payment_id='in_replay_fixture'`)[0].count, 1);
  const [afterFirst] = await sql`select valid_until from idoc.memberships where id=${membership.id}`;
  const expected = new Date(before.valid_until);
  expected.setUTCFullYear(expected.getUTCFullYear() + 1);
  assert.equal(afterFirst.valid_until, expected.toISOString().slice(0, 10));
  assert.equal((await sql`select count(*)::int as count from idoc.stripe_events where external_event_id='evt_replay_fixture'`)[0].count, 1);
});
