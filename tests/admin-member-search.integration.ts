import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { getPrivateMember, listAuditHistory, searchMembersForAdmin, updateMemberProfile } from '../lib/membership/data-access.ts';
import { adminUser, asAdmin, closeHarness, createMembership, createProfile, createUser, profileInput, resetIdoc } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('an admin can search for a member, review them, correct their profile with a reason, and see it in the audit trail', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await createMembership(profile.id);

  const results = await asAdmin(admin.id, () => searchMembersForAdmin(member.email));
  assert.equal(results.length, 1);
  assert.equal(results[0].profileId, profile.id);

  const detail = await asAdmin(admin.id, () => getPrivateMember(profile.id));
  assert.equal(detail?.profile.id, profile.id);

  await asAdmin(admin.id, () => updateMemberProfile(profile.id, profileInput(), { reason: 'Corrected address per member phone call' }));

  const history = await asAdmin(admin.id, () => listAuditHistory(profile.id));
  const [entry] = history.filter((row) => row.action === 'admin.profile.updated');
  assert.ok(entry);
  assert.equal(entry.actorId, admin.id);
  assert.equal(entry.reason, 'Corrected address per member phone call');
});
