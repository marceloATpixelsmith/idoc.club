import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { correctEntitlement, reinstateMembership, suspendMembership } from '../lib/membership/status-actions.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import type { CancellationStripeClient } from '../lib/payments/stripe.ts';
import { adminUser, asAdmin, closeHarness, createMembership, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

function fakeStripeClient(calls: string[], shouldThrow = false): CancellationStripeClient {
  return {
    subscriptions: {
      cancel: async (id: string) => {
        calls.push(id);
        if (shouldThrow) throw new Error('stripe unavailable');
        return { id, status: 'canceled' };
      },
    },
  };
}

async function withOpenSubscription(profileId: number, externalSubscriptionId = 'sub_fixture') {
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values (${profileId}, ${externalSubscriptionId}, 'price_fixture', 'active', current_date + 30, false)`;
}

test('suspend cancels an open Stripe subscription, freezes validUntil, and writes an audit entry', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true); // valid_until 2099-12-31
  await withOpenSubscription(profile.id, 'sub_open');
  const calls: string[] = [];

  const result = await asAdmin(admin.id, () => suspendMembership(profile.id, 'Policy violation', fakeStripeClient(calls)));
  assert.equal(result.membership.status, 'suspended');
  assert.equal(result.membership.validUntil, '2099-12-31');
  assert.equal(result.stripeCancelled, true);
  assert.deepEqual(calls, ['sub_open']);

  const [audit] = await sql`select action, actor_id, reason, entity_type, entity_id from idoc.audit_log where action='admin.membership.suspended'`;
  assert.equal(audit.actor_id, admin.id);
  assert.equal(audit.reason, 'Policy violation');
  assert.equal(audit.entity_type, 'profile');
  assert.equal(audit.entity_id, String(profile.id));
});

test('suspend with no subscription on file does not attempt a Stripe call', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  const calls: string[] = [];

  const result = await asAdmin(admin.id, () => suspendMembership(profile.id, 'No billing relationship', fakeStripeClient(calls)));
  assert.equal(result.membership.status, 'suspended');
  assert.equal(result.stripeCancelled, false);
  assert.equal(result.stripeCancelError, undefined);
  assert.deepEqual(calls, []);
});

test('suspending an already-suspended membership with no open subscription is rejected and writes no new audit row', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'suspended','2025-01-01','2099-12-31','migration')`;

  await assert.rejects(asAdmin(admin.id, () => suspendMembership(profile.id, 'Already suspended')));
  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where entity_id=${String(profile.id)}`)[0].count, 0);
});

test('suspending an already-suspended membership with a still-open subscription retries the Stripe cancellation without a duplicate audit row', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'suspended','2025-01-01','2099-12-31','migration')`;
  await withOpenSubscription(profile.id, 'sub_still_open');
  const calls: string[] = [];

  const result = await asAdmin(admin.id, () => suspendMembership(profile.id, 'Retry after crash', fakeStripeClient(calls)));
  assert.equal(result.stripeCancelled, true);
  assert.deepEqual(calls, ['sub_still_open']);
  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where entity_id=${String(profile.id)}`)[0].count, 0);
});

test('a Stripe cancellation failure does not block the suspension and is reported, not thrown', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await withOpenSubscription(profile.id);
  const calls: string[] = [];

  const result = await asAdmin(admin.id, () => suspendMembership(profile.id, 'Reason', fakeStripeClient(calls, true)));
  assert.equal(result.membership.status, 'suspended');
  assert.equal(result.stripeCancelled, false);
  assert.equal(result.stripeCancelError, 'stripe unavailable');
  const [row] = await sql`select status from idoc.memberships where profile_id=${profile.id}`;
  assert.equal(row.status, 'suspended');
});

test('a non-administrator cannot suspend a membership', async () => {
  const nonAdmin = await createUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await assert.rejects(withTestMembershipBoundary({ actor: { id: nonAdmin.id, roles: [] } }, () => suspendMembership(profile.id, 'Should not be permitted')));
  assert.equal((await sql`select status from idoc.memberships where profile_id=${profile.id}`)[0].status, 'active');
});

test('a missing reason is rejected and writes nothing', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await assert.rejects(asAdmin(admin.id, () => suspendMembership(profile.id, '')));
  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where entity_id=${String(profile.id)}`)[0].count, 0);
});

test('concurrent suspend calls for the same profile write exactly one audit entry', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await Promise.allSettled([
    asAdmin(admin.id, () => suspendMembership(profile.id, 'Concurrent suspend 1')),
    asAdmin(admin.id, () => suspendMembership(profile.id, 'Concurrent suspend 2')),
  ]);
  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where action='admin.membership.suspended'`)[0].count, 1);
  assert.equal((await sql`select status from idoc.memberships where profile_id=${profile.id}`)[0].status, 'suspended');
});

for (const status of ['active', 'grace', 'complimentary', 'canceled'] as const) {
  test(`reinstate restores status '${status}' and leaves validUntil untouched`, async () => {
    const admin = await adminUser();
    const member = await createUser();
    const profile = await createProfile(member.id);
    await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'suspended','2025-01-01','2099-06-15','migration')`;

    const result = await asAdmin(admin.id, () => reinstateMembership(profile.id, { reason: 'Dispute resolved', status }));
    assert.equal(result.membership.status, status);
    assert.equal(result.membership.validUntil, '2099-06-15');

    const [audit] = await sql`select action, reason from idoc.audit_log where action='admin.membership.reinstated'`;
    assert.equal(audit.reason, 'Dispute resolved');
  });
}

test('reinstating a membership that is not suspended is rejected', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true); // status active
  await assert.rejects(asAdmin(admin.id, () => reinstateMembership(profile.id, { reason: 'Not actually suspended', status: 'active' })));
});

test('reinstating a profile with no membership on file is rejected', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await assert.rejects(asAdmin(admin.id, () => reinstateMembership(profile.id, { reason: 'No membership', status: 'active' })));
});

test('correctEntitlement can set validUntil only', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true); // active, 2099-12-31
  const result = await asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Fixing a data-entry mistake', validUntil: '2030-06-15' }));
  assert.equal(result.membership.validUntil, '2030-06-15');
  assert.equal(result.membership.status, 'active');
});

test('correctEntitlement can set status only', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  const result = await asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Was incorrectly marked active', status: 'review_required' }));
  assert.equal(result.membership.status, 'review_required');
  assert.equal(result.membership.validUntil, '2099-12-31');
});

test('correctEntitlement can set both validUntil and status together', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  const result = await asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Full correction', status: 'complimentary', validUntil: '2031-01-01' }));
  assert.equal(result.membership.status, 'complimentary');
  assert.equal(result.membership.validUntil, '2031-01-01');
});

test('correctEntitlement with neither validUntil nor status is rejected', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await assert.rejects(asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Nothing to change' })));
});

test('correctEntitlement rejects status=\'suspended\' — suspension must go through suspendMembership', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await assert.rejects(asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Trying to bypass suspend', status: 'suspended' })));
});

test('correctEntitlement on a profile with no membership is rejected — it corrects, it does not grant', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await assert.rejects(asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'No membership yet', validUntil: '2030-01-01' })));
});

test('correctEntitlement rejects a resulting validUntil earlier than startsOn with a clean error, not a raw constraint violation', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'active','2026-01-01','2099-12-31','migration')`;
  const error = await asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Bad date', validUntil: '2025-01-01' })).catch((caught) => caught);
  assert.ok(error instanceof Error);
  assert.match(error.message, /paid-through date cannot be before the start date/);
  const [row] = await sql`select valid_until from idoc.memberships where profile_id=${profile.id}`;
  assert.equal(row.valid_until, '2099-12-31');
});
