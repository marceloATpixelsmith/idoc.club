import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createMembershipCheckoutSession, SUBSCRIPTION_REPLACE_FAILED } from '../lib/payments/checkout.ts';
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
      checkout: { sessions: { create: async (params: unknown, options: unknown) => { calls.sessionsCreate.push(params); calls.sessionsCreateOptions.push(options); return { expires_at: Math.floor(Date.now() / 1000) + 1800, id: `cs_fixture_${Date.now()}_${calls.sessionsCreate.length}_${Math.random().toString(36).slice(2)}`, status: 'open', url: 'https://checkout.stripe.com/session/fixture' }; }, retrieve } },
      customers: { create: async (params: unknown) => { calls.customersCreate.push(params); return { id: `cus_fixture_created_${Date.now()}_${Math.random().toString(36).slice(2)}` }; } },
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
  assert.match(row.external_customer_id, /^cus_fixture_created_/);

  const second = fakeStripeClient();
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipCheckoutSession('payment', second.client));
  assert.equal(second.calls.customersCreate.length, 0, 'an existing billing account must be reused, not recreated');
  assert.equal((second.calls.sessionsCreate[0] as any).customer, row.external_customer_id);
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

// ---- Replacing a stuck (past-due / incomplete) subscription so the member can pay again ----

type LiveInvoice = { id: string; status: string } | null;
type ReplaceOptions = {
  // Checkout Sessions Stripe reports for the subscription; `expireEnds` models Stripe ending the subscription (and voiding its invoice) when its Session is expired.
  sessions?: { id: string; status: string }[]; expireEnds?: boolean;
};
function replaceClient(initial: { invoice?: LiveInvoice; status: string; retrieveError?: unknown }, failures: { cancel?: boolean; checkout?: boolean; expire?: boolean; void?: boolean } = {}, options: ReplaceOptions = {}) {
  const base = fakeStripeClient();
  const order: string[] = [];
  const live = { ...initial };
  const sessionsCreate = base.client.checkout.sessions.create;
  const client = {
    ...base.client,
    checkout: { sessions: { ...base.client.checkout.sessions,
      create: async (params: unknown, createOptions: unknown) => { if (failures.checkout) throw new Error('stripe checkout down'); order.push('checkout'); return sessionsCreate(params, createOptions as never); },
      expire: async (id: string) => { if (failures.expire) throw new Error('stripe expire down'); order.push(`expire:${id}`); if (options.expireEnds) { live.status = 'canceled'; live.invoice = { id: 'in_unpaid_fixture', status: 'void' }; } return { id, status: 'expired' }; },
      list: async () => { order.push('list-sessions'); return { data: options.sessions ?? [] }; },
    } },
    invoices: { voidInvoice: async (id: string) => { if (failures.void) throw new Error('stripe void down'); order.push(`void:${id}`); return { id }; } },
    subscriptions: {
      cancel: async (id: string) => { if (failures.cancel) throw new Error('stripe cancel down'); order.push(`cancel:${id}`); return { id, status: 'canceled' }; },
      retrieve: async (id: string) => { if (live.retrieveError) throw live.retrieveError; return { id, latest_invoice: live.invoice === undefined ? { id: 'in_unpaid_fixture', status: 'open' } : live.invoice, status: live.status }; },
    },
  };
  return { client, order };
}

async function stuckMember(localStatus = 'past_due') {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  await sql`insert into idoc.subscriptions(profile_id,external_subscription_id,price_id,status,current_period_end)
    values(${profile.id},'sub_stuck_fixture','price_fixture',${localStatus},'2027-11-14')`;
  return { actor: { id: user.id, roles: [] as string[] }, profile };
}
const subscriptionStatus = async () => (await sql`select status from idoc.subscriptions where external_subscription_id='sub_stuck_fixture'`)[0].status;
const run = (actor: { id: number; roles: string[] }, client: unknown) => withTestMembershipBoundary({ actor }, () => createMembershipCheckoutSession('subscription', client as never));

test('a past-due subscription is replaced: invoice voided, then canceled, then recorded, then checkout created', async () => {
  const { actor, profile } = await stuckMember();
  const { client, order } = replaceClient({ status: 'past_due' });
  assert.equal(await run(actor, client), 'https://checkout.stripe.com/session/fixture');
  assert.deepEqual(order, ['void:in_unpaid_fixture', 'cancel:sub_stuck_fixture', 'checkout']);
  assert.equal(await subscriptionStatus(), 'canceled');
  const [audit] = await sql`select action,entity_id,before_json,after_json from idoc.audit_log where action='billing.stuck_subscription_replaced'`;
  assert.equal(audit.entity_id, 'sub_stuck_fixture');
  assert.equal(audit.before_json.localStatus, 'past_due');
  assert.equal((await sql`select count(*)::int c from idoc.membership_checkout_sessions where profile_id=${profile.id}`)[0].c, 1);
});

test('an incomplete subscription is replaced the same way', async () => {
  const { actor } = await stuckMember('incomplete');
  const { client, order } = replaceClient({ status: 'incomplete' });
  await run(actor, client);
  assert.deepEqual(order, ['list-sessions', 'void:in_unpaid_fixture', 'cancel:sub_stuck_fixture', 'checkout'], 'no originating Checkout Session is open, so nothing is expired');
});

test('a subscription that is actually active in Stripe is never replaced, even if IDOC still shows it past due', async () => {
  const { actor } = await stuckMember();
  const { client, order } = replaceClient({ status: 'active' });
  await assert.rejects(run(actor, client), /active or pending subscription/);
  assert.deepEqual(order, []);
  assert.equal(await subscriptionStatus(), 'past_due');
});

test('an invoice that has been paid since is never voided and the subscription is left alone', async () => {
  const { actor } = await stuckMember();
  const { client, order } = replaceClient({ invoice: { id: 'in_paid_fixture', status: 'paid' }, status: 'past_due' });
  await assert.rejects(run(actor, client), /active or pending subscription/);
  assert.deepEqual(order, []);
  assert.equal(await subscriptionStatus(), 'past_due');
});

test('if voiding the invoice fails nothing else is changed, and a retry succeeds', async () => {
  const { actor } = await stuckMember();
  const failing = replaceClient({ status: 'past_due' }, { void: true });
  await assert.rejects(run(actor, failing.client), (error: Error) => error.message === SUBSCRIPTION_REPLACE_FAILED);
  assert.deepEqual(failing.order, []);
  assert.equal(await subscriptionStatus(), 'past_due');
  assert.equal((await sql`select count(*)::int c from idoc.membership_checkout_sessions`)[0].c, 0);
  const retry = replaceClient({ status: 'past_due' });
  await run(actor, retry.client);
  assert.equal(await subscriptionStatus(), 'canceled');
});

test('if the cancel fails after the invoice was voided, the retry skips the already-void invoice and finishes', async () => {
  const { actor } = await stuckMember();
  const failing = replaceClient({ status: 'past_due' }, { cancel: true });
  await assert.rejects(run(actor, failing.client), (error: Error) => error.message === SUBSCRIPTION_REPLACE_FAILED);
  assert.deepEqual(failing.order, ['void:in_unpaid_fixture']);
  assert.equal(await subscriptionStatus(), 'past_due');
  const retry = replaceClient({ invoice: { id: 'in_unpaid_fixture', status: 'void' }, status: 'past_due' });
  await run(actor, retry.client);
  assert.deepEqual(retry.order, ['cancel:sub_stuck_fixture', 'checkout']);
  assert.equal(await subscriptionStatus(), 'canceled');
});

test('if the new checkout fails after the replacement, the member is not blocked and the retry works', async () => {
  const { actor } = await stuckMember();
  const failing = replaceClient({ status: 'past_due' }, { checkout: true });
  await assert.rejects(run(actor, failing.client), /stripe checkout down/);
  assert.equal(await subscriptionStatus(), 'canceled');
  const retry = replaceClient({ status: 'canceled' });
  assert.equal(await run(actor, retry.client), 'https://checkout.stripe.com/session/fixture');
  assert.deepEqual(retry.order, ['checkout']);
});

test('a subscription Stripe already ended, or no longer has, is only synced locally', async () => {
  for (const live of [{ status: 'canceled' }, { retrieveError: Object.assign(new Error('gone'), { code: 'resource_missing' }), status: 'x' }]) {
    await resetIdoc();
    const { actor } = await stuckMember();
    const { client, order } = replaceClient(live);
    await run(actor, client);
    assert.deepEqual(order, ['checkout']);
    assert.equal(await subscriptionStatus(), 'canceled');
  }
});

test('an unpaid subscription with an already-voided invoice is canceled without a second void', async () => {
  const { actor } = await stuckMember();
  const { client, order } = replaceClient({ invoice: { id: 'in_x', status: 'void' }, status: 'unpaid' });
  await run(actor, client);
  assert.deepEqual(order, ['cancel:sub_stuck_fixture', 'checkout']);
});

test('an incomplete Checkout subscription has its open Checkout Session expired before anything else is changed', async () => {
  const { actor } = await stuckMember('incomplete');
  const { client, order } = replaceClient({ status: 'incomplete' }, {}, { sessions: [{ id: 'cs_origin_fixture', status: 'open' }] });
  await run(actor, client);
  assert.deepEqual(order, ['list-sessions', 'expire:cs_origin_fixture', 'void:in_unpaid_fixture', 'cancel:sub_stuck_fixture', 'checkout']);
  assert.equal(await subscriptionStatus(), 'canceled');
});

test('when expiring the Checkout Session already ended the subscription in Stripe, it is only synced locally', async () => {
  const { actor } = await stuckMember('incomplete');
  const { client, order } = replaceClient({ status: 'incomplete' }, {}, { expireEnds: true, sessions: [{ id: 'cs_origin_fixture', status: 'open' }] });
  await run(actor, client);
  assert.deepEqual(order, ['list-sessions', 'expire:cs_origin_fixture', 'checkout'], 'no void or cancel is attempted on an already-ended subscription');
  assert.equal(await subscriptionStatus(), 'canceled');
});

test('only open Checkout Sessions are expired', async () => {
  const { actor } = await stuckMember('incomplete');
  const { client, order } = replaceClient({ status: 'incomplete' }, {}, { sessions: [{ id: 'cs_done', status: 'complete' }, { id: 'cs_old', status: 'expired' }, { id: 'cs_open', status: 'open' }] });
  await run(actor, client);
  assert.deepEqual(order.filter((step) => step.startsWith('expire:')), ['expire:cs_open']);
});

test('if expiring the Checkout Session fails nothing else is changed, and a retry succeeds', async () => {
  const { actor } = await stuckMember('incomplete');
  const failing = replaceClient({ status: 'incomplete' }, { expire: true }, { sessions: [{ id: 'cs_origin_fixture', status: 'open' }] });
  await assert.rejects(run(actor, failing.client), (error: Error) => error.message === SUBSCRIPTION_REPLACE_FAILED);
  assert.deepEqual(failing.order, ['list-sessions']);
  assert.equal(await subscriptionStatus(), 'incomplete');
  const retry = replaceClient({ status: 'incomplete' }, {}, { sessions: [{ id: 'cs_origin_fixture', status: 'open' }] });
  await run(actor, retry.client);
  assert.equal(await subscriptionStatus(), 'canceled');
});

test('a past-due subscription never touches Checkout Sessions', async () => {
  const { actor } = await stuckMember();
  const { client, order } = replaceClient({ status: 'past_due' }, {}, { sessions: [{ id: 'cs_origin_fixture', status: 'open' }] });
  await run(actor, client);
  assert.equal(order.some((step) => step.startsWith('expire:') || step === 'list-sessions'), false);
});
