import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { renewalMode } from '../lib/membership/entitlement.ts';
import { getPrivateMember } from '../lib/membership/data-access.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { closeHarness, createMembership, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

const entitlement = { status: 'active', validUntil: '2099-12-31' };

test('renewalMode classifies each subscription/entitlement combination correctly', () => {
  assert.equal(renewalMode({ cancelAtPeriodEnd: false, status: 'active' }, entitlement), 'auto_renew');
  assert.equal(renewalMode({ cancelAtPeriodEnd: true, status: 'active' }, entitlement), 'cancels_at_period_end');
  assert.equal(renewalMode({ cancelAtPeriodEnd: false, status: 'past_due' }, entitlement), 'auto_renew');
  assert.equal(renewalMode(null, entitlement), 'manual');
  // A terminal Stripe subscription row (e.g. canceled) still on file must not count as "open" —
  // the member is on the manual/no-longer-auto-billing track even though a subscription row exists.
  assert.equal(renewalMode({ cancelAtPeriodEnd: false, status: 'canceled' }, entitlement), 'manual');
  assert.equal(renewalMode(null, null), 'none');
});

async function asOwner<T>(userId: number, operation: () => Promise<T>) {
  return withTestMembershipBoundary({ actor: { id: userId, roles: [] } }, operation);
}

test('getPrivateMember surfaces the latest subscription row for an auto-renewing member', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);
  await sql`insert into idoc.subscriptions(profile_id, external_subscription_id, price_id, status, current_period_end, cancel_at_period_end)
    values (${profile.id}, 'sub_fixture', 'price_fixture', 'active', current_date + 30, false)`;

  const member = await asOwner(user.id, () => getPrivateMember(profile.id));
  assert.equal(member?.subscription?.status, 'active');
  assert.equal(member?.subscription?.cancelAtPeriodEnd, false);
  assert.equal(renewalMode(member!.subscription, member!.entitlement), 'auto_renew');
});

test('getPrivateMember returns null subscription for a manual/one-time member with none on file', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);

  const member = await asOwner(user.id, () => getPrivateMember(profile.id));
  assert.equal(member?.subscription, null);
  assert.equal(renewalMode(member!.subscription, member!.entitlement), 'manual');
});
