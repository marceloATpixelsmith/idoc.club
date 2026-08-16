import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createMembershipCheckoutSession } from '../lib/payments/checkout.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { closeHarness, createMembership, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(async () => {
  process.env.BASE_URL = 'https://idoc.club';
  process.env.STRIPE_ONE_TIME_PRODUCT_ID = 'prod_one_time_fixture';
  process.env.STRIPE_RECURRING_PRODUCT_ID = 'prod_recurring_fixture';
  await resetIdoc();
});
after(closeHarness);

function fakeStripeClient() {
  const calls = { customersCreate: [] as unknown[], sessionsCreate: [] as unknown[] };
  return {
    calls,
    client: {
      checkout: { sessions: { create: async (params: unknown) => { calls.sessionsCreate.push(params); return { url: 'https://checkout.stripe.com/session/fixture' }; } } },
      customers: { create: async (params: unknown) => { calls.customersCreate.push(params); return { id: 'cus_fixture_created' }; } },
    },
  };
}

test('a first-time checkout creates a Stripe Customer, persists billing_accounts, and never asks for one again', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  const { calls, client } = fakeStripeClient();

  const url = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('subscription', client));
  assert.equal(url, 'https://checkout.stripe.com/session/fixture');
  assert.equal(calls.customersCreate.length, 1);
  const [row] = await sql`select external_customer_id from idoc.billing_accounts where profile_id=${profile.id}`;
  assert.equal(row.external_customer_id, 'cus_fixture_created');

  const second = fakeStripeClient();
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('payment', second.client));
  assert.equal(second.calls.customersCreate.length, 0, 'an existing billing account must be reused, not recreated');
  assert.equal((second.calls.sessionsCreate[0] as any).customer, 'cus_fixture_created');
});

test('subscription mode requests a recurring annual price against the recurring product; payment mode requests a one-time price against the one-time product', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);

  const subscription = fakeStripeClient();
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('subscription', subscription.client));
  const subscriptionParams = subscription.calls.sessionsCreate[0] as any;
  assert.equal(subscriptionParams.mode, 'subscription');
  assert.equal(subscriptionParams.line_items[0].price_data.product, 'prod_recurring_fixture');
  assert.deepEqual(subscriptionParams.line_items[0].price_data.recurring, { interval: 'year' });
  assert.equal(subscriptionParams.line_items[0].price_data.unit_amount, 8000);
  assert.equal(subscriptionParams.line_items[0].price_data.currency, 'eur');
  assert.deepEqual(subscriptionParams.metadata, { mode: 'subscription', profileId: String(profile.id) });

  await resetIdoc();
  const user2 = await createUser();
  const profile2 = await createProfile(user2.id);
  await createMembership(profile2.id);
  const payment = fakeStripeClient();
  await withTestMembershipBoundary({ actor: { id: user2.id, roles: [] } }, () => createMembershipCheckoutSession('payment', payment.client));
  const paymentParams = payment.calls.sessionsCreate[0] as any;
  assert.equal(paymentParams.mode, 'payment');
  assert.equal(paymentParams.line_items[0].price_data.product, 'prod_one_time_fixture');
  assert.equal(paymentParams.line_items[0].price_data.recurring, undefined);
});

test('a member with no profile cannot start checkout', async () => {
  const user = await createUser('onboarding');
  const { client } = fakeStripeClient();
  await assert.rejects(withTestMembershipBoundary(
    { actor: { id: user.id, roles: [] } },
    () => createMembershipCheckoutSession('subscription', client),
  ));
});

test('a member with an already-open subscription cannot start a second subscription checkout', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  await sql`insert into idoc.subscriptions(profile_id,external_subscription_id,price_id,status,current_period_end)
    values(${profile.id},'sub_existing_fixture','price_fixture','active','2099-12-31')`;
  const { client, calls } = fakeStripeClient();

  await assert.rejects(
    withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('subscription', client)),
    /active or pending subscription/,
  );
  assert.equal(calls.customersCreate.length, 0, 'no Stripe Customer should be created once the duplicate-subscription guard rejects');
  assert.equal(calls.sessionsCreate.length, 0);

  const paymentSession = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('payment', client));
  assert.equal(paymentSession, 'https://checkout.stripe.com/session/fixture', 'one-time payment mode must remain unaffected by an open subscription');
});

test('a missing product configuration fails closed rather than silently starting checkout against the wrong product', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  delete process.env.STRIPE_RECURRING_PRODUCT_ID;
  const { client } = fakeStripeClient();
  await assert.rejects(
    withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('subscription', client)),
    /STRIPE_RECURRING_PRODUCT_ID/,
  );
  assert.equal((await sql`select count(*)::int as count from idoc.billing_accounts where profile_id=${profile.id}`)[0].count, 0);
});
