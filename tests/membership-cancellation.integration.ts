import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { cancelOwnMembership } from '../lib/membership/data-access.ts';
import { isEntitled } from '../lib/membership/entitlement.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { cancelMemberSubscription } from '../lib/payments/stripe.ts';
import { closeHarness, createCompleteGraph, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

function fakeCancellationClient(behavior: 'succeed' | 'throw' = 'succeed') {
  const calls: string[] = [];
  return {
    calls,
    client: {
      subscriptions: {
        cancel: async (id: string) => {
          calls.push(id);
          if (behavior === 'throw') throw new Error('Stripe is unavailable.');
          return { id, status: 'canceled' };
        },
      },
    },
  };
}

async function insertOpenSubscription(profileId: number, externalSubscriptionId = 'sub_fixture') {
  await sql`insert into idoc.subscriptions(profile_id,external_subscription_id,price_id,status,current_period_end)
    values(${profileId},${externalSubscriptionId},'price_fixture','active','2099-12-31')`;
}

test('cancelOwnMembership ends access immediately, cancels an open Stripe subscription, and writes a self-service audit entry', async () => {
  const { profile, user } = await createCompleteGraph();
  await insertOpenSubscription(profile.id);
  const { calls, client } = fakeCancellationClient();
  const [before] = await sql`select valid_until from idoc.memberships where profile_id=${profile.id}`;

  const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));

  // 'suspended', not 'canceled' -- reuses suspendMembership's own proven "deny access regardless of
  // valid_until, don't touch the date" semantics rather than backdating valid_until, which can
  // violate memberships_dates_check when starts_on is today (a Codex review finding on the first
  // version of this function).
  assert.equal(result.membership.status, 'suspended');
  assert.equal(result.stripeCancelled, true);
  assert.deepEqual(calls, ['sub_fixture']);

  const today = new Date().toISOString().slice(0, 10);
  assert.equal(result.membership.validUntil, before.valid_until, 'valid_until must be left untouched -- status alone denies access');
  assert.equal(isEntitled({ status: result.membership.status, validUntil: result.membership.validUntil }, today), false);

  const [audit] = await sql`select action,actor_id,entity_type,entity_id from idoc.audit_log
    where entity_type='profile' and entity_id=${String(profile.id)} and action='member.membership_canceled'`;
  assert.ok(audit, 'a self-service cancellation audit row must exist');
  assert.equal(audit.actor_id, user.id);
});

test('a membership that starts today can still be cancelled the same day (valid_until >= starts_on is never violated)', async () => {
  // The exact scenario the original backdating approach broke: starts_on = today means any
  // valid_until before today would violate memberships_dates_check and roll back the whole
  // cancellation, silently leaving access and any subscription active.
  const { user, profile } = await createCompleteGraph();
  const today = new Date().toISOString().slice(0, 10);
  await sql`update idoc.memberships set starts_on=${today}, valid_until=${today} where profile_id=${profile.id}`;
  const { client } = fakeCancellationClient();

  const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));

  assert.equal(result.membership.status, 'suspended');
  assert.equal(result.membership.validUntil, today);
  assert.equal(isEntitled({ status: result.membership.status, validUntil: result.membership.validUntil }, today), false);
});

test('cancellation is unconditional even when the Stripe cancellation fails', async () => {
  const { profile, user } = await createCompleteGraph();
  await insertOpenSubscription(profile.id);
  const { client } = fakeCancellationClient('throw');

  const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));

  assert.equal(result.membership.status, 'suspended');
  assert.equal(result.stripeCancelled, false);
  assert.ok(result.stripeCancelError);
});

test('a member with no open Stripe subscription is cleanly canceled without any Stripe call', async () => {
  const { user } = await createCompleteGraph();
  const { calls, client } = fakeCancellationClient();

  const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));

  assert.equal(result.membership.status, 'suspended');
  assert.equal(result.stripeCancelled, false);
  assert.deepEqual(calls, []);
});

test('a member with no membership on file cannot cancel', async () => {
  const user = await createUser();
  await createProfile(user.id);
  const { client } = fakeCancellationClient();
  await assert.rejects(
    withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client)),
    /No membership on file/,
  );
});

test('a member with no profile at all cannot request cancellation', async () => {
  const user = await createUser();
  const { client } = fakeCancellationClient();
  await assert.rejects(
    withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client)),
    /A member profile is required/,
  );
});

test('cancelMemberSubscription (the Stripe call cancelOpenSubscriptionIfAny delegates to) rejects a client override outside NODE_ENV=test', async () => {
  // Exercised directly rather than through cancelOwnMembership: that path requires
  // withTestMembershipBoundary for actor resolution, which itself demands NODE_ENV=test, so the two
  // guards can't both be exercised in the same call stack. cancelMemberSubscription has no actor
  // resolution of its own (lib/payments/stripe.ts: "No authorization check of its own"), so its
  // override guard is testable in isolation.
  const { client } = fakeCancellationClient();
  const originalEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  try {
    await assert.rejects(cancelMemberSubscription('sub_fixture', client), /test-only/);
  } finally {
    Object.assign(process.env, { NODE_ENV: originalEnv });
  }
});
