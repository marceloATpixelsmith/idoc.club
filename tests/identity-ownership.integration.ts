import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createCompleteGraph, createMembership, createProfile, createUser, closeHarness, profileInput, resetIdoc, sql } from './postgres-harness.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { getOwnPrivateMember, getPrivateMember, hasCurrentMemberEntitlement, updateMemberProfile } from '../lib/membership/data-access.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('real profile boundaries allow owners and deny cross-account reads, writes, and entitlement bypasses', async () => {
  const owner = await createUser();
  const ownerProfile = await createProfile(owner.id);
  await createMembership(ownerProfile.id);
  const attacker = await createUser();
  const attackerProfile = await createProfile(attacker.id);
  await createMembership(attackerProfile.id);

  const own = await withTestMembershipBoundary({ actor: { id: owner.id, roles: [] } }, () => getOwnPrivateMember());
  assert.equal(own?.profile.id, ownerProfile.id);
  await assert.rejects(withTestMembershipBoundary({ actor: { id: attacker.id, roles: ['super_admin'] } }, () => getPrivateMember(ownerProfile.id)));
  await assert.rejects(withTestMembershipBoundary({ actor: { id: attacker.id, roles: [] } }, () => updateMemberProfile(ownerProfile.id, profileInput())));
  await assert.rejects(withTestMembershipBoundary({ actor: { id: attacker.id, roles: [] } }, () => hasCurrentMemberEntitlement(ownerProfile.id)));
  assert.equal((await sql`select first_name from idoc.profiles where id=${ownerProfile.id}`)[0].first_name, 'Test');
});

test('server-managed grants permit administrator ownership override and ignore claimed actor roles', async () => {
  const { profile } = await createCompleteGraph();
  const administrator = await createUser();
  await assert.rejects(withTestMembershipBoundary({ actor: { id: administrator.id, roles: ['super_admin'] } }, () => getPrivateMember(profile.id)));
  await sql`insert into idoc.application_roles(user_id,role,granted_by) values(${administrator.id},'administrator',${administrator.id})`;
  const result = await withTestMembershipBoundary({ actor: { id: administrator.id, roles: [] } }, () => getPrivateMember(profile.id));
  assert.equal(result?.profile.id, profile.id);
});

test('compatibility teams cannot grant profile, member, or administrator access', async () => {
  const owner = await createCompleteGraph();
  const attacker = await createUser();
  const [team] = await sql`insert into idoc.teams(name,subscription_status) values('Legacy administrator','active') returning id`;
  await sql`insert into idoc.team_members(user_id,team_id,role) values(${attacker.id},${team.id},'owner')`;
  await assert.rejects(withTestMembershipBoundary({ actor: { id: attacker.id, roles: [] } }, () => getPrivateMember(owner.profile.id)));
});
