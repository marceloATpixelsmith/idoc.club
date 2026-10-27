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
    checkout: { sessions: { expire: async (id: string) => { calls.push(`expire:${id}`); return {}; } } },
    subscriptions: {
      update: async (id: string, params: { cancel_at_period_end: boolean }) => {
        calls.push(`${id}:${params.cancel_at_period_end}`);
        if (shouldThrow) throw new Error('stripe unavailable');
        return { id, status: 'active' };
      },
    },
  };
}

async function withOpenSubscription(profileId: number, externalSubscriptionId = 'sub_fixture') {
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values (${profileId}, ${externalSubscriptionId}, 'price_fixture', 'active', current_date + 30, false)`;
}

test('cancel ends an open Stripe subscription at period end, keeps validUntil, and writes an audit entry', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true); // valid_until 2099-12-31
  await withOpenSubscription(profile.id, 'sub_open');
  const calls: string[] = [];

  const result = await asAdmin(admin.id, () => suspendMembership(profile.id, 'Policy violation', fakeStripeClient(calls)));
  assert.equal(result.membership.status, 'canceled');
  assert.equal(result.membership.validUntil, '2099-12-31');
  assert.equal(result.stripeCancelled, true);
  assert.deepEqual(calls, ['sub_open:true']);

  const [audit] = await sql`select action, actor_id, reason, entity_type, entity_id from idoc.audit_log where action='admin.membership.canceled'`;
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
  assert.equal(result.membership.status, 'canceled');
  assert.equal(result.stripeCancelled, false);
  assert.equal(result.stripeCancelError, undefined);
  assert.deepEqual(calls, []);
});

test('suspending an already-suspended membership with no open subscription is rejected and writes no new audit row', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'canceled','2025-01-01','2099-12-31','migration')`;

  await assert.rejects(asAdmin(admin.id, () => suspendMembership(profile.id, 'Already suspended')));
  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where entity_id=${String(profile.id)}`)[0].count, 0);
});

test('suspending an already-suspended membership with a still-open subscription retries the Stripe cancellation without a duplicate audit row', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'canceled','2025-01-01','2099-12-31','migration')`;
  await withOpenSubscription(profile.id, 'sub_still_open');
  const calls: string[] = [];

  const result = await asAdmin(admin.id, () => suspendMembership(profile.id, 'Retry after crash', fakeStripeClient(calls)));
  assert.equal(result.stripeCancelled, true);
  assert.deepEqual(calls, ['sub_still_open:true']);
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
  assert.equal(result.membership.status, 'canceled');
  assert.equal(result.stripeCancelled, false);
  assert.equal(result.stripeCancelError, 'stripe unavailable');
  const [row] = await sql`select status from idoc.memberships where profile_id=${profile.id}`;
  assert.equal(row.status, 'canceled');
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
  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where action='admin.membership.canceled'`)[0].count, 1);
  assert.equal((await sql`select status from idoc.memberships where profile_id=${profile.id}`)[0].status, 'canceled');
});

for (const status of ['active', 'grace', 'complimentary'] as const) {
  test(`reinstate restores status '${status}' and leaves validUntil untouched`, async () => {
    const admin = await adminUser();
    const member = await createUser();
    const profile = await createProfile(member.id);
    await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'canceled','2025-01-01','2099-06-15','migration')`;

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

test('correctEntitlement rejects status=\'suspended\' — cancellation must go through suspendMembership', async () => {
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

test('a legacy suspended membership can still be reinstated', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'suspended','2025-01-01','2099-06-15','migration')`;
  const result = await asAdmin(admin.id, () => reinstateMembership(profile.id, { reason: 'Legacy suspension lifted', status: 'active' }));
  assert.equal(result.membership.status, 'active');
});

// Strix on #713: a hold must also stop the member being billed and paying -- open subscription ended at period end, open Checkout
// sessions expired -- not only be guarded when a late payment arrives.
async function withOpenCheckoutSessions(profileId: number) {
  await sql`insert into idoc.membership_checkout_sessions(profile_id, external_checkout_session_id, mode, cycle, status, idempotency_key, attempt)
    values (${profileId}, ${`cs_open_${profileId}`}, 'payment', '2099-12-31', 'open', ${`idem_${profileId}`}, 1)`;
}

test('moving a membership to review_required ends its open subscription at period end and expires its open Checkout sessions', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await withOpenSubscription(profile.id, 'sub_review');
  await withOpenCheckoutSessions(profile.id);
  const calls: string[] = [];
  const result = await asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Under review', status: 'review_required' }, fakeStripeClient(calls)));
  assert.equal(result.membership.status, 'review_required');
  assert.deepEqual(calls.sort(), [`expire:cs_open_${profile.id}`, 'sub_review:true']);
  assert.equal((await sql`select status from idoc.membership_checkout_sessions where profile_id=${profile.id}`)[0].status, 'expired');
});

test('correcting only the date, or to a non-held status, leaves subscriptions and Checkout sessions alone', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await withOpenSubscription(profile.id, 'sub_untouched');
  await withOpenCheckoutSessions(profile.id);
  const calls: string[] = [];
  await asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Date fix', validUntil: '2099-06-30' }, fakeStripeClient(calls)));
  await asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Still active', status: 'active' }, fakeStripeClient(calls)));
  assert.deepEqual(calls, []);
  assert.equal((await sql`select status from idoc.membership_checkout_sessions where profile_id=${profile.id}`)[0].status, 'open');
});

test('cancelling a membership expires its open Checkout sessions, and a Stripe failure neither blocks the cancellation nor marks them expired', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await withOpenCheckoutSessions(profile.id);
  const calls: string[] = [];
  const failing = { ...fakeStripeClient(calls), checkout: { sessions: { expire: async () => { throw new Error('stripe unavailable'); } } } };
  const result = await asAdmin(admin.id, () => suspendMembership(profile.id, 'Policy violation', failing));
  assert.equal(result.membership.status, 'canceled');
  assert.equal(result.checkoutSessionsExpired, 0);
  assert.equal(result.checkoutExpiryFailed, 1, 'the failure is reported so the admin form can warn');
  assert.equal((await sql`select status from idoc.membership_checkout_sessions where profile_id=${profile.id}`)[0].status, 'open', 'left open so the webhook guard still protects the membership');
});

test('repeating a hold correction retries Stripe cleanup that failed the first time, even though the status is already held', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await withOpenCheckoutSessions(profile.id);
  const calls: string[] = [];
  const failing = { ...fakeStripeClient(calls), checkout: { sessions: { expire: async () => { throw new Error('stripe unavailable'); } } } };
  await asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Under review', status: 'review_required' }, failing));
  assert.equal((await sql`select status from idoc.membership_checkout_sessions where profile_id=${profile.id}`)[0].status, 'open');
  const retried = await asAdmin(admin.id, () => correctEntitlement(profile.id, { reason: 'Retry cleanup', status: 'review_required' }, fakeStripeClient(calls)));
  assert.equal(retried.membership.status, 'review_required');
  assert.deepEqual(calls, [`expire:cs_open_${profile.id}`]);
  assert.equal((await sql`select status from idoc.membership_checkout_sessions where profile_id=${profile.id}`)[0].status, 'expired');
});

test('repeating a cancellation whose Checkout links still cannot be expired returns the warning result instead of "already canceled"', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id, true);
  await withOpenCheckoutSessions(profile.id);
  const calls: string[] = [];
  const failing = { ...fakeStripeClient(calls), checkout: { sessions: { expire: async () => { throw new Error('stripe unavailable'); } } } };
  await asAdmin(admin.id, () => suspendMembership(profile.id, 'Policy violation', failing));
  const again = await asAdmin(admin.id, () => suspendMembership(profile.id, 'Retry', failing));
  assert.equal(again.checkoutExpiryFailed, 1);
});
