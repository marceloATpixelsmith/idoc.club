import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createMembershipPortalSession } from '../lib/payments/stripe.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import {
  closeHarness, createCompleteGraph, createMembership, createProfile, createUser, resetIdoc,
} from './postgres-harness.ts';

beforeEach(async () => {
  process.env.BASE_URL = 'https://idoc.club';
  await resetIdoc();
});
after(closeHarness);

function fakePortalClient() {
  const calls = { configurationsCreate: [] as unknown[], sessionsCreate: [] as unknown[] };
  let configurations: Array<{ id: string }> = [];
  return {
    calls,
    client: {
      billingPortal: {
        configurations: {
          create: async (params: unknown) => {
            calls.configurationsCreate.push(params);
            const created = { id: `cfg_${calls.configurationsCreate.length}` };
            configurations = [created];
            return created;
          },
          list: async () => ({ data: configurations }),
        },
        sessions: { create: async (params: unknown) => { calls.sessionsCreate.push(params); return { url: 'https://billing.stripe.com/session/fixture' }; } },
      },
    },
  };
}

test('a Stripe-backed member gets a portal session scoped to their own billing account', async () => {
  const { user } = await createCompleteGraph();
  const { calls, client } = fakePortalClient();

  const url = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipPortalSession(client));
  assert.equal(url, 'https://billing.stripe.com/session/fixture');
  assert.equal(calls.sessionsCreate.length, 1);
  const sessionParams = calls.sessionsCreate[0] as any;
  assert.equal(sessionParams.customer, 'cus_fixture');
  assert.equal(sessionParams.return_url, 'https://idoc.club/dashboard');
  assert.equal(sessionParams.configuration, 'cfg_1');
  assert.equal(calls.configurationsCreate.length, 1, 'no existing configuration means one must be created');
});

test('no existing Billing Portal Configuration is created with exactly payment_method_update, invoice_history, and at-period-end subscription_cancel, never subscription_update', async () => {
  const { user } = await createCompleteGraph();
  const { calls, client } = fakePortalClient();
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipPortalSession(client));
  const params = calls.configurationsCreate[0] as any;
  assert.deepEqual(Object.keys(params.features).sort(), ['invoice_history', 'payment_method_update', 'subscription_cancel']);
  assert.equal(params.features.payment_method_update.enabled, true);
  assert.equal(params.features.invoice_history.enabled, true);
  assert.equal(params.features.subscription_cancel.enabled, true);
  assert.equal(params.features.subscription_cancel.mode, 'at_period_end');
});

test('a second session for the same member reuses the existing Billing Portal Configuration instead of creating another', async () => {
  const { user } = await createCompleteGraph();
  const { calls, client } = fakePortalClient();
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipPortalSession(client));
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipPortalSession(client));
  assert.equal(calls.configurationsCreate.length, 1);
  assert.equal(calls.sessionsCreate.length, 2);
  assert.equal((calls.sessionsCreate[1] as any).configuration, 'cfg_1');
});

test('a member with a profile but no Stripe billing account is rejected, and no Stripe call is made', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  const { calls, client } = fakePortalClient();
  await assert.rejects(
    withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipPortalSession(client)),
    /No Stripe billing account/,
  );
  assert.equal(calls.configurationsCreate.length, 0);
  assert.equal(calls.sessionsCreate.length, 0);
});

test('a member with no profile at all cannot request a portal session', async () => {
  const user = await createUser('onboarding');
  const { client } = fakePortalClient();
  await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createMembershipPortalSession(client)));
});

test('a Stripe client override is rejected outside NODE_ENV=test', async () => {
  const { client } = fakePortalClient();
  const originalEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  try {
    await assert.rejects(createMembershipPortalSession(client), /test-only/);
  } finally {
    Object.assign(process.env, { NODE_ENV: originalEnv });
  }
});
