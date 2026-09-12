import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createMembershipCheckoutSession } from '../lib/payments/checkout.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { closeHarness, createMembership, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(async () => {
  process.env.BASE_URL = 'https://idoc.club';
  process.env.STRIPE_MEMBERSHIP_PRODUCT_ID = 'prod_membership_fixture';
  await resetIdoc();
});
after(closeHarness);

function fakeStripeClient(retrieve: (id: string) => Promise<{ expires_at?: number | null; status?: string | null; url: string | null }> =
  async () => ({ expires_at: Math.floor(Date.now() / 1000) + 1800, status: 'open', url: 'https://checkout.stripe.com/session/fixture' })) {
  const calls = { customersCreate: [] as unknown[], sessionsCreate: [] as unknown[], sessionsCreateOptions: [] as unknown[] };
  return {
    calls,
    client: {
      checkout: { sessions: { create: async (params: unknown, options: unknown) => { calls.sessionsCreate.push(params); calls.sessionsCreateOptions.push(options); return { expires_at: Math.floor(Date.now() / 1000) + 1800, id: `cs_fixture_${calls.sessionsCreate.length}`, status: 'open', url: 'https://checkout.stripe.com/session/fixture' }; }, retrieve } },
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

test('duplicate membership Checkout requests use one provider idempotency key for the paid-through cycle', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  const { calls, client } = fakeStripeClient();

  await Promise.all([
    withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('payment', client)),
    withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('payment', client)),
  ]);
  assert.equal(calls.sessionsCreate.length, 1);
  assert.equal((await sql`select count(*)::int count from idoc.membership_checkout_sessions`)[0].count, 1);
  assert.match((calls.sessionsCreateOptions[0] as any).idempotencyKey, new RegExp(`^idoc-membership-checkout-${profile.id}-payment-`));
});

for (const providerStatus of ['expired', 'complete', 'canceled'] as const) {
  test(`${providerStatus} membership Checkout evidence is retained and replaced with a rotated key`, async () => {
    const user = await createUser();
    const profile = await createProfile(user.id);
    await createMembership(profile.id);
    const first = fakeStripeClient();
    await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('payment', first.client));
    const replacement = fakeStripeClient(async () => ({ status: providerStatus, url: null }));
    await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('payment', replacement.client));
    const rows = await sql`select status,idempotency_key from idoc.membership_checkout_sessions order by attempt`;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, providerStatus === 'expired' ? 'expired' : providerStatus === 'complete' ? 'completed' : 'superseded');
    assert.equal(rows[1].status, 'open');
    assert.notEqual(rows[0].idempotency_key, rows[1].idempotency_key);
  });
}

test('an open payable membership Checkout is retrieved and reused without creating another provider object', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  const first = fakeStripeClient();
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('payment', first.client));
  const retry = fakeStripeClient(async () => ({ expires_at: Math.floor(Date.now() / 1000) + 60, status: 'open', url: 'https://checkout.stripe.com/session/reused' }));
  const url = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('payment', retry.client));
  assert.equal(url, 'https://checkout.stripe.com/session/reused');
  assert.equal(retry.calls.sessionsCreate.length, 0);
  assert.equal((await sql`select count(*)::int count from idoc.membership_checkout_sessions`)[0].count, 1);
});

test('a provider creation failure is retained and the retry uses a new durable attempt', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  const failed = fakeStripeClient();
  failed.client.checkout.sessions.create = async () => { throw new Error('transport unavailable'); };
  await assert.rejects(withTestMembershipBoundary(
    { actor: { id: user.id, roles: [] } },
    () => createMembershipCheckoutSession('payment', failed.client),
  ), /transport unavailable/);
  const retry = fakeStripeClient();
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('payment', retry.client));
  const rows = await sql`select status,attempt,idempotency_key from idoc.membership_checkout_sessions order by attempt`;
  assert.deepEqual(rows.map(({ attempt, status }) => ({ attempt, status })), [
    { attempt: 1, status: 'failed' }, { attempt: 2, status: 'open' },
  ]);
  assert.notEqual(rows[0].idempotency_key, rows[1].idempotency_key);
});

test('both checkout modes use the canonical membership Product with mode-appropriate Price data', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);

  const subscription = fakeStripeClient();
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('subscription', subscription.client));
  const subscriptionParams = subscription.calls.sessionsCreate[0] as any;
  assert.equal(subscriptionParams.mode, 'subscription');
  assert.equal(subscriptionParams.line_items[0].price_data.product, 'prod_membership_fixture');
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
  assert.equal(paymentParams.line_items[0].price_data.product, 'prod_membership_fixture');
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
  delete process.env.STRIPE_MEMBERSHIP_PRODUCT_ID;
  const { client } = fakeStripeClient();
  await assert.rejects(
    withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('subscription', client)),
    /STRIPE_MEMBERSHIP_PRODUCT_ID/,
  );
  assert.equal((await sql`select count(*)::int as count from idoc.billing_accounts where profile_id=${profile.id}`)[0].count, 0);
});
