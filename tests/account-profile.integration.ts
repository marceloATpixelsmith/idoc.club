import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createMembership, createProfile, createUser, closeHarness, grantRole, judgeRole, profileInput, resetIdoc, sql, stewardRole, veterinarianRole } from './postgres-harness.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { createOwnMemberProfile, getOwnPrivateMember, requireAccountAccess } from '../lib/membership/data-access.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('persisted account-state and entitlement matrix is enforced at the direct server boundary', async () => {
  const rows: Array<{ allowed: string[]; current: boolean; state: Parameters<typeof createUser>[0] }> = [
    { state: 'unverified' as const, current: false, allowed: [] as string[] },
    { state: 'onboarding' as const, current: false, allowed: ['onboarding'] },
    { state: 'active' as const, current: true, allowed: ['account', 'billing_boundary', 'member', 'profile', 'renewal'] },
    { state: 'active' as const, current: false, allowed: ['account', 'billing_boundary', 'profile', 'renewal'] },
    { state: 'suspended' as const, current: true, allowed: [] },
    { state: 'migrated_pending' as const, current: true, allowed: [] },
    { state: 'deleted' as const, current: true, allowed: [] },
  ];
  const operations = ['account', 'billing_boundary', 'member', 'onboarding', 'profile', 'renewal'] as const;
  for (const row of rows) {
    const user = await createUser(row.state);
    if (row.state !== 'onboarding' && row.state !== 'unverified') {
      const profile = await createProfile(user.id);
      await createMembership(profile.id, row.current);
    }
    for (const operation of operations) {
      const invocation = withTestMembershipBoundary({ actor: { id: user.id, roles: ['super_admin'] } }, () => requireAccountAccess(operation));
      if (row.allowed.includes(operation)) await invocation;
      else await assert.rejects(invocation);
    }
  }
});

test('administrator and Super Admin access comes only from persisted grants', async () => {
  const administrator = await createUser();
  const profile = await createProfile(administrator.id);
  await createMembership(profile.id);
  await assert.rejects(withTestMembershipBoundary({ actor: { id: administrator.id, roles: ['super_admin'] } }, () => requireAccountAccess('administration')));
  await grantRole(administrator.id, 'administrator');
  await withTestMembershipBoundary({ actor: { id: administrator.id, roles: [] } }, () => requireAccountAccess('administration'));
});

test('onboarding validates and atomically creates each approved classification without teams', async () => {
  const classifications = [[judgeRole], [stewardRole], [judgeRole, stewardRole], [veterinarianRole]];
  for (const roles of classifications) {
    const user = await createUser('onboarding');
    await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(profileInput(roles)));
    const result = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => getOwnPrivateMember());
    assert.deepEqual(result?.roles.map(({ roleType }) => roleType).sort(), roles.map(({ roleType }) => roleType).sort());
  }
});

test('invalid professional payloads persist nothing', async () => {
  const invalid = [
    { ...profileInput(), countryCode: 'XX' },
    { ...profileInput(), roles: [{ ...judgeRole, feiId: '' }] },
    { ...profileInput(), roles: [{ ...judgeRole, idocRegion: 'Invented Region' }] },
    { ...profileInput(), roles: [{ ...judgeRole, nationalFederationCountryCode: 'XX' }] },
    { ...profileInput(), roles: [{ ...judgeRole, officialStatus: 'Invented status' }] },
    { ...profileInput(), roles: [{ roleType: 'veterinarian', feiId: 'not-applicable' }] },
    { ...profileInput(), roles: [judgeRole, veterinarianRole] },
  ];
  for (const payload of invalid) {
    const user = await createUser('onboarding');
    await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(payload)));
    assert.equal((await sql`select 1 from idoc.profiles where user_id=${user.id}`).length, 0);
  }
});
