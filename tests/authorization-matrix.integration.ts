import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import {
  closeHarness, createCompleteGraph, createMembership, createProfile, createUser,
  grantRole, judgeRole, profileInput, resetIdoc, sql,
} from './postgres-harness.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { getPrivateMember, hasCurrentMemberEntitlement, listAuditHistory, updateMemberProfile } from '../lib/membership/data-access.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('persisted Super Admin and administrator grants read and administer across accounts; ordinary members and unpersisted role claims cannot', async () => {
  const { profile: ownerProfile } = await createCompleteGraph();
  const superAdmin = await createUser();
  await grantRole(superAdmin.id, 'super_admin');
  const administrator = await createUser();
  await grantRole(administrator.id, 'administrator');
  const member = await createUser();
  await createProfile(member.id);

  for (const grantedActor of [superAdmin, administrator]) {
    const read = await withTestMembershipBoundary({ actor: { id: grantedActor.id, roles: [] } }, () => getPrivateMember(ownerProfile.id));
    assert.equal(read?.profile.id, ownerProfile.id);
    const history = await withTestMembershipBoundary({ actor: { id: grantedActor.id, roles: [] } }, () => listAuditHistory(ownerProfile.id));
    assert.ok(Array.isArray(history));
  }

  await assert.rejects(withTestMembershipBoundary({ actor: { id: member.id, roles: [] } }, () => getPrivateMember(ownerProfile.id)));
  await assert.rejects(withTestMembershipBoundary({ actor: { id: member.id, roles: [] } }, () => listAuditHistory(ownerProfile.id)));

  // Browser-claimed administrator/super_admin roles are ignored: this member has no persisted grant.
  await assert.rejects(withTestMembershipBoundary({ actor: { id: member.id, roles: ['administrator'] } }, () => getPrivateMember(ownerProfile.id)));
  await assert.rejects(withTestMembershipBoundary({ actor: { id: member.id, roles: ['super_admin'] } }, () => listAuditHistory(ownerProfile.id)));
});

test('suspended, deleted, and revoked administrator grants are denied even though a role grant exists', async () => {
  const { profile: ownerProfile } = await createCompleteGraph();

  const suspended = await createUser('suspended');
  await grantRole(suspended.id, 'administrator');
  await assert.rejects(withTestMembershipBoundary({ actor: { id: suspended.id, roles: [] } }, () => getPrivateMember(ownerProfile.id)));

  const deleted = await createUser('deleted');
  await grantRole(deleted.id, 'administrator');
  await assert.rejects(withTestMembershipBoundary({ actor: { id: deleted.id, roles: [] } }, () => listAuditHistory(ownerProfile.id)));

  const revoked = await createUser();
  await grantRole(revoked.id, 'administrator');
  await sql`update idoc.application_roles set revoked_at=now() where user_id=${revoked.id}`;
  await assert.rejects(withTestMembershipBoundary({ actor: { id: revoked.id, roles: [] } }, () => getPrivateMember(ownerProfile.id)));
});

// withTestMembershipBoundary injects the attacker's own genuine, persisted user id (it does not
// forge session/cookie identity resolution); only the claimed `roles` array is attacker-controlled
// here, and authenticatedActor() re-derives roles from application_roles regardless of this claim.
test('forged roles claimed by a genuine attacker account cannot reach another account through the direct server boundary', async () => {
  const { profile: ownerProfile, user: owner } = await createCompleteGraph();
  const attacker = await createUser();
  await createProfile(attacker.id);

  await assert.rejects(withTestMembershipBoundary({ actor: { id: attacker.id, roles: ['administrator', 'super_admin'] } }, () => getPrivateMember(ownerProfile.id)));
  await assert.rejects(withTestMembershipBoundary({ actor: { id: attacker.id, roles: ['super_admin'] } }, () => updateMemberProfile(ownerProfile.id, profileInput())));
  await assert.rejects(withTestMembershipBoundary({ actor: { id: attacker.id, roles: ['administrator'] } }, () => hasCurrentMemberEntitlement(ownerProfile.id)));

  const [unchanged] = await sql`select first_name from idoc.profiles where user_id=${owner.id}`;
  assert.equal(unchanged.first_name, 'Test');
});

test('member profile self-service mutation ignores privileged and cross-account fields and leaves the rest of the graph unchanged', async () => {
  const { profile, user } = await createCompleteGraph();
  const before = {
    applicationRoles: await sql`select * from idoc.application_roles where user_id=${user.id}`,
    billing: await sql`select * from idoc.billing_accounts where profile_id=${profile.id}`,
    memberships: await sql`select * from idoc.memberships where profile_id=${profile.id}`,
    migration: await sql`select * from idoc.migration_map where new_entity_id=${String(user.id)}`,
    userRow: await sql`select account_state, session_version from idoc.users where id=${user.id}`,
  };
  assert.equal(before.applicationRoles.length, 0);

  const maliciousInput = {
    ...profileInput([judgeRole]),
    accountState: 'active',
    billingOwnerId: 999,
    complimentary: true,
    entitlement: true,
    firstName: 'Escalated',
    id: 999,
    membershipStatus: 'active',
    migrationMap: 'tampered',
    paymentStatus: 'paid',
    role: 'super_admin',
    stripeCustomerId: 'cus_hacked',
    stripeSubscriptionId: 'sub_hacked',
    userId: 999,
  };
  const updated = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => updateMemberProfile(profile.id, maliciousInput));
  assert.equal(updated.firstName, 'Escalated');
  assert.equal('role' in updated, false);
  assert.equal('accountState' in updated, false);
  assert.equal('stripeCustomerId' in updated, false);

  const after = {
    applicationRoles: await sql`select * from idoc.application_roles where user_id=${user.id}`,
    billing: await sql`select * from idoc.billing_accounts where profile_id=${profile.id}`,
    memberships: await sql`select * from idoc.memberships where profile_id=${profile.id}`,
    migration: await sql`select * from idoc.migration_map where new_entity_id=${String(user.id)}`,
    userRow: await sql`select account_state, session_version from idoc.users where id=${user.id}`,
  };
  assert.deepEqual(after.applicationRoles, before.applicationRoles);
  assert.deepEqual(after.billing, before.billing);
  assert.deepEqual(after.memberships, before.memberships);
  assert.deepEqual(after.migration, before.migration);
  assert.deepEqual(after.userRow, before.userRow);
});
