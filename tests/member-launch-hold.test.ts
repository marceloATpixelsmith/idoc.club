import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { guardStripeMutations, liveBillingDisabled, memberCommunicationsDisabled, MemberLaunchHoldError } from '../lib/runtime/member-launch-hold.ts';

const original = { hold: process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING, key: process.env.STRIPE_SECRET_KEY, node: process.env.NODE_ENV, vercel: process.env.VERCEL_ENV, base: process.env.BASE_URL };
afterEach(() => {
  for (const [name, value] of Object.entries({ DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: original.hold, STRIPE_SECRET_KEY: original.key, NODE_ENV: original.node, VERCEL_ENV: original.vercel, BASE_URL: original.base })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

for (const value of [undefined, '', 'true', 'invalid', 'FALSE', ' false ', '0']) {
  test(`communications fail closed for ${JSON.stringify(value)}`, () => {
    assert.equal(memberCommunicationsDisabled({ DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: value }), true);
  });
}
test('only exact false releases communications', () => {
  assert.equal(memberCommunicationsDisabled({ DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'false' }), false);
});
test('live billing fails closed, but a validated sandbox key remains usable', () => {
  const environment = { NODE_ENV: 'test', STRIPE_SECRET_KEY: `sk_test_${'a'.repeat(24)}`, DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'true' };
  assert.equal(liveBillingDisabled(environment), false);
  assert.equal(liveBillingDisabled(environment, true), true);
  assert.equal(liveBillingDisabled({ ...environment, STRIPE_SECRET_KEY: undefined }), true);
  assert.equal(liveBillingDisabled({ ...environment, STRIPE_SECRET_KEY: 'sk_test_fake' }), true);
  assert.equal(liveBillingDisabled({ ...environment, DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'false' }, true), false);
});
test('Stripe action boundary blocks every covered mutation, including captured calls, without blocking reads', async () => {
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'true';
  let mutations = 0;
  const resource = { create: async () => { mutations++; }, update: async () => { mutations++; }, cancel: async () => { mutations++; }, resume: async () => { mutations++; }, retrieve: async () => 'read', list: async () => ['read'] };
  const guarded = guardStripeMutations({ subscriptions: resource, refunds: resource, subscriptionSchedules: resource }, true);
  assert.equal(await guarded.subscriptions.retrieve(), 'read');
  assert.deepEqual(await guarded.subscriptions.list(), ['read']);
  const captured = guarded.subscriptionSchedules.create;
  for (const operation of [guarded.refunds.create, guarded.subscriptions.update, guarded.subscriptions.cancel, guarded.subscriptions.resume, captured]) {
    assert.throws(() => operation(), MemberLaunchHoldError);
  }
  assert.equal(mutations, 0);
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'false';
  await captured();
  assert.equal(mutations, 1);
});

test('blocked provider attempts log only their operation category', () => {
  process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'true';
  const warning = console.warn;
  const evidence: unknown[][] = [];
  console.warn = (...args: unknown[]) => { evidence.push(args); };
  try {
    const stripe = guardStripeMutations({ refunds: { create: (_payload: unknown) => { throw new Error('provider must not run'); } } }, true);
    assert.throws(() => stripe.refunds.create({ email: 'private@example.test', token: 'raw-auth-token', payment: 'pi_private' }), MemberLaunchHoldError);
    const serialized = JSON.stringify(evidence);
    assert.match(serialized, /billing.stripe_mutation/);
    assert.doesNotMatch(serialized, /private@example|raw-auth-token|pi_private/);
  } finally { console.warn = warning; }
});
