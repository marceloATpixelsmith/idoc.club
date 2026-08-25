import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createMembership, createProfile, createUser, closeHarness, grantRole, judgeRole, persistedGraph, profileInput, resetIdoc, sql, stewardRole, veterinarianRole } from './postgres-harness.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { createOwnMemberProfile, getOwnPrivateMember, requireAccountAccess, updateMemberProfile } from '../lib/membership/data-access.ts';

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
    { ...profileInput(), roles: [{ ...judgeRole, officialStatuses: ['Invented status'] }] },
    { ...profileInput(), roles: [{ roleType: 'veterinarian', feiId: 'not-applicable' }] },
    { ...profileInput(), roles: [judgeRole, veterinarianRole] },
  ];
  for (const payload of invalid) {
    const user = await createUser('onboarding');
    await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(payload)));
    assert.equal((await sql`select 1 from idoc.profiles where user_id=${user.id}`).length, 0);
  }
});

test('onboarding rejects missing required consent and persists no profile evidence', async () => {
  const user = await createUser('onboarding');
  await assert.rejects(withTestMembershipBoundary(
    { actor: { id: user.id, roles: [] } },
    () => createOwnMemberProfile(profileInput(), {
      keepUpdated: true,
      privacyAccepted: false,
      termsAccepted: true,
    }),
  ));
  assert.equal((await sql`select 1 from idoc.profiles where user_id=${user.id}`).length, 0);
  assert.equal((await sql`select 1 from idoc.onboarding_consents`).length, 0);
});

test('canonical field validation rejects every invalid edit without changing the complete persisted graph', async () => {
  const invalid = [
    { ...profileInput(), countryCode: 'XX' },
    { ...profileInput(), roles: [{ ...judgeRole, nationalFederationCountryCode: 'XX' }] },
    { ...profileInput(), roles: [{ ...judgeRole, idocRegion: 'Invented Region' }] },
    { ...profileInput(), roles: [{ ...judgeRole, feiId: '' }] },
    { ...profileInput(), roles: [{ ...judgeRole, officialStatuses: ['Invented Judge'] }] },
    { ...profileInput(), roles: [{ ...stewardRole, officialStatuses: ['Invented Steward'] }] },
    { ...profileInput(), roles: [{ ...judgeRole, isTechnicalDelegate: 'yes' }] },
    { ...profileInput(), roles: [judgeRole, veterinarianRole] },
    { ...profileInput(), roles: [{ roleType: 'veterinarian', feiId: 'forbidden' }] },
  ];
  for (const payload of invalid) {
    await resetIdoc();
    const user = await createUser();
    const profile = await createProfile(user.id);
    await createMembership(profile.id);
    const before = await persistedGraph(user.id);
    await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => updateMemberProfile(profile.id, payload)));
    assert.deepEqual(await persistedGraph(user.id), before);
  }
});

test('controlled onboarding failures roll back profile, roles, history, audit, and account-state transition', async () => {
  const stages = ['profile-write', 'role-insertion', 'consent-write', 'profile-history-insertion', 'audit-insertion', 'account-state-transition'] as const;
  for (const stage of stages) {
    await resetIdoc();
    const user = await createUser('onboarding');
    await assert.rejects(withTestMembershipBoundary(
      { actor: { id: user.id, roles: [] }, failAt: stage },
      () => createOwnMemberProfile(profileInput()),
    ));
    const [persistedUser] = await sql`select account_state from idoc.users where id=${user.id}`;
    assert.equal(persistedUser.account_state, 'onboarding');
    for (const table of ['profiles', 'professional_roles', 'profile_change_history', 'audit_log']) {
      assert.equal((await sql.unsafe(`select count(*)::int as count from idoc.${table}`))[0].count, 0, `${stage}:${table}`);
    }
  }
});
