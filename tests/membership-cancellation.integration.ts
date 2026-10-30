import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { cancelOwnMembership } from '../lib/membership/data-access.ts';
import { suspendMembership } from '../lib/membership/status-actions.ts';
import { isEntitled } from '../lib/membership/entitlement.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { cancelMemberSubscriptionAtPeriodEnd } from '../lib/payments/stripe.ts';
import { closeHarness, createCompleteGraph, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

function fakeCancellationClient(behavior: 'succeed' | 'throw' = 'succeed') {
  const calls: string[] = [];
  return {
    calls,
    client: {
      subscriptions: {
        update: async (id: string, params: { cancel_at_period_end: boolean }) => {
          calls.push(`${id}:${params.cancel_at_period_end}`);
          if (behavior === 'throw') throw new Error('Stripe is unavailable.');
          return { id, status: 'active' };
        },
      },
    },
  };
}

async function insertOpenSubscription(profileId: number, externalSubscriptionId = 'sub_fixture') {
  await sql`insert into idoc.subscriptions(profile_id,external_subscription_id,price_id,status,current_period_end)
    values(${profileId},${externalSubscriptionId},'price_fixture','active','2099-12-31')`;
}

test('cancelOwnMembership keeps access to the end of the paid cycle, ends the Stripe subscription at period end, and writes a self-service audit entry', async () => {
  const { profile, user } = await createCompleteGraph();
  await insertOpenSubscription(profile.id);
  const { calls, client } = fakeCancellationClient();
  const [before] = await sql`select valid_until from idoc.memberships where profile_id=${profile.id}`;

  const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));

  // 'canceled' with valid_until untouched: the member keeps access through the paid-through date.
  assert.equal(result.membership.status, 'canceled');
  assert.equal(result.stripeCancelled, true);
  assert.deepEqual(calls, ['sub_fixture:true'], 'the subscription is set to end at period end, never cancelled immediately');

  const today = new Date().toISOString().slice(0, 10);
  assert.equal(result.membership.validUntil, before.valid_until, 'valid_until must be left untouched');
  assert.equal(isEntitled({ status: result.membership.status, validUntil: result.membership.validUntil }, today), true);
  assert.equal(isEntitled({ status: result.membership.status, validUntil: result.membership.validUntil }, '2100-01-01'), false);

  const [audit] = await sql`select action,actor_id,entity_type,entity_id from idoc.audit_log
    where entity_type='profile' and entity_id=${String(profile.id)} and action='member.membership_canceled'`;
  assert.ok(audit, 'a self-service cancellation audit row must exist');
  assert.equal(audit.actor_id, user.id);
});

test('a membership that starts today can still be cancelled the same day (valid_until >= starts_on is never violated)', async () => {
  // valid_until is never moved by a cancellation, so no date constraint can be violated.
  const { user, profile } = await createCompleteGraph();
  const today = new Date().toISOString().slice(0, 10);
  await sql`update idoc.memberships set starts_on=${today}, valid_until=${today} where profile_id=${profile.id}`;
  const { client } = fakeCancellationClient();

  const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));

  assert.equal(result.membership.status, 'canceled');
  assert.equal(result.membership.validUntil, today);
  assert.equal(isEntitled({ status: result.membership.status, validUntil: result.membership.validUntil }, today), true);
});

test('cancellation is unconditional even when the Stripe call fails', async () => {
  const { profile, user } = await createCompleteGraph();
  await insertOpenSubscription(profile.id);
  const { client } = fakeCancellationClient('throw');

  const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));

  assert.equal(result.membership.status, 'canceled');
  assert.equal(result.stripeCancelled, false);
  assert.ok(result.stripeCancelError);
});

test('a member with no open Stripe subscription is cleanly canceled without any Stripe call', async () => {
  const { user } = await createCompleteGraph();
  const { calls, client } = fakeCancellationClient();

  const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));

  assert.equal(result.membership.status, 'canceled');
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

test('cancelMemberSubscriptionAtPeriodEnd (the Stripe call cancelOpenSubscriptionIfAny delegates to) rejects a client override outside NODE_ENV=test', async () => {
  // Exercised directly rather than through cancelOwnMembership: that path requires
  // withTestMembershipBoundary for actor resolution, which itself demands NODE_ENV=test, so the two
  // guards can't both be exercised in the same call stack. cancelMemberSubscriptionAtPeriodEnd has no actor
  // resolution of its own (lib/payments/stripe.ts: "No authorization check of its own"), so its
  // override guard is testable in isolation.
  const { client } = fakeCancellationClient();
  const originalEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  try {
    await assert.rejects(cancelMemberSubscriptionAtPeriodEnd('sub_fixture', client), /test-only/);
  } finally {
    Object.assign(process.env, { NODE_ENV: originalEnv });
  }
});

async function insertPendingSchedule(profileId: number)
    {
    await sql`insert into idoc.renewal_preferences(profile_id,current_mode,pending_mode,effective_on,external_subscription_schedule_id,transition_state)
        values(${profileId},'non_recurring','recurring','2099-12-31','sub_sched_fixture','pending_activation')`;
    }

function fakeScheduleClient(options: { fail?: boolean; status?: string; activateOnRelease?: boolean } = {})
    {
    const calls: string[] = [];
    return {
        calls,
        client: {
            subscriptionSchedules: {
                retrieve: async (id: string) => ({ id, status: options.status ?? 'not_started', subscription: options.status === 'active' ? 'sub_schedule_activated' : null }),
                release: async (id: string) => {
                    calls.push(`release:${id}`);
                    if (options.fail) throw new Error('Schedule provider unavailable.');
                    return { released_subscription: options.status === 'active' || options.activateOnRelease ? 'sub_schedule_activated' : null };
                },
            },
            subscriptions: {
                update: async (id: string, params: { cancel_at_period_end: boolean }) => {
                    calls.push(`subscription:${id}:${params.cancel_at_period_end}`);
                    return { id, status: 'active' };
                },
            },
        },
    };
    }

test('member cancellation stops a future schedule without a subscription and clears pending renewal only after confirmation', async () => {
    const { profile, user } = await createCompleteGraph();
    await insertPendingSchedule(profile.id);
    const { calls, client } = fakeScheduleClient();
    const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));
    assert.equal(result.membership.status, 'canceled');
    assert.equal(result.stripeCancelled, true);
    assert.deepEqual(calls, ['release:sub_sched_fixture']);
    const [preference] = await sql`select * from idoc.renewal_preferences where profile_id=${profile.id}`;
    assert.equal(preference.current_mode, 'non_recurring');
    assert.equal(preference.pending_mode, null);
    assert.equal(preference.external_subscription_schedule_id, null);
});

test('schedule failure remains retryable and does not skip existing subscription cancellation', async () => {
    const { profile, user } = await createCompleteGraph();
    await insertPendingSchedule(profile.id);
    await insertOpenSubscription(profile.id);
    const failed = fakeScheduleClient({ fail: true });
    const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(failed.client));
    assert.equal(result.membership.status, 'canceled');
    assert.equal(result.stripeCancelled, false);
    assert.match(result.stripeCancelError ?? '', /Schedule provider unavailable/);
    assert.deepEqual(failed.calls, ['release:sub_sched_fixture', 'subscription:sub_fixture:true']);
    const [retained] = await sql`select external_subscription_schedule_id,pending_mode from idoc.renewal_preferences where profile_id=${profile.id}`;
    assert.equal(retained.external_subscription_schedule_id, 'sub_sched_fixture');
    assert.equal(retained.pending_mode, 'recurring');
    const retry = fakeScheduleClient();
    const retried = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(retry.client));
    assert.equal(retried.stripeCancelled, true);
    const [cleared] = await sql`select external_subscription_schedule_id from idoc.renewal_preferences where profile_id=${profile.id}`;
    assert.equal(cleared.external_subscription_schedule_id, null);
});

test('a schedule activating before its webhook is released and its subscription ends at period end', async () => {
    const { profile, user } = await createCompleteGraph();
    await insertPendingSchedule(profile.id);
    const { calls, client } = fakeScheduleClient({ status: 'active' });
    const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));
    assert.equal(result.stripeCancelled, true);
    assert.deepEqual(calls, ['release:sub_sched_fixture', 'subscription:sub_schedule_activated:true']);
    assert.equal(isEntitled({ status: result.membership.status, validUntil: result.membership.validUntil }, new Date().toISOString().slice(0, 10)), true);
});

test('administrator membership cancellation also stops a pending renewal schedule', async () => {
    const { profile } = await createCompleteGraph();
    await insertPendingSchedule(profile.id);
    const admin = await createUser();
    const { calls, client } = fakeScheduleClient();
    const result = await withTestMembershipBoundary({ actor: { id: admin.id, roles: ['administrator'] } }, () => suspendMembership(profile.id, 'Member requested cancellation.', client));
    assert.equal(result.stripeCancelled, true);
    assert.deepEqual(calls, ['release:sub_sched_fixture']);
});

test('activation between schedule retrieval and release preserves the active subscription through period end', async () => {
    const { profile, user } = await createCompleteGraph();
    await insertPendingSchedule(profile.id);
    const { calls, client } = fakeScheduleClient({ activateOnRelease: true });
    const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => cancelOwnMembership(client));
    assert.equal(result.stripeCancelled, true);
    assert.deepEqual(calls, ['release:sub_sched_fixture', 'subscription:sub_schedule_activated:true']);
    const [cleared] = await sql`select external_subscription_schedule_id from idoc.renewal_preferences where profile_id=${profile.id}`;
    assert.equal(cleared.external_subscription_schedule_id, null);
});
