import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import {
  closeHarness, createMembership, createProfile, createUser, judgeRole, persistedGraph,
  profileInput, resetIdoc, sql, stewardRole, veterinarianRole,
} from './postgres-harness.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { createOwnMemberProfile, getOwnPrivateMember, updateMemberProfile } from '../lib/membership/data-access.ts';

beforeEach(resetIdoc);
after(closeHarness);

type Role = typeof judgeRole | typeof stewardRole | typeof veterinarianRole;
type PersistedRole = {
  feiId: string | null; idocRegion: string | null; isTechnicalDelegate: boolean | null;
  nationalFederationCountryCode: string | null; officialStatus: string | null; roleType: string;
};

function assertRolesMatchExactly(persistedRoles: PersistedRole[] | undefined, expectedRoles: Role[], label: string) {
  const sortedPersisted = persistedRoles?.slice().sort((a, b) => a.roleType.localeCompare(b.roleType));
  const sortedExpected = expectedRoles.slice().sort((a, b) => a.roleType.localeCompare(b.roleType));
  assert.equal(sortedPersisted?.length, sortedExpected.length, `${label}: role count`);
  for (const [index, role] of sortedExpected.entries()) {
    const persisted: PersistedRole | undefined = sortedPersisted?.[index];
    assert.equal(persisted?.roleType, role.roleType, `${label}: roleType`);
    assert.equal(persisted?.feiId, 'feiId' in role ? role.feiId : null, `${label}: feiId`);
    assert.equal(persisted?.idocRegion, 'idocRegion' in role ? role.idocRegion : null, `${label}: idocRegion`);
    assert.equal(persisted?.nationalFederationCountryCode, 'nationalFederationCountryCode' in role ? role.nationalFederationCountryCode : null, `${label}: nationalFederationCountryCode`);
    assert.equal(persisted?.officialStatus, 'officialStatus' in role ? role.officialStatus : null, `${label}: officialStatus`);
    assert.equal(persisted?.isTechnicalDelegate, 'isTechnicalDelegate' in role ? role.isTechnicalDelegate : null, `${label}: isTechnicalDelegate`);
  }
}

test('valid onboarding and edit persist exact canonical values for every approved classification, both as create and edit target', async () => {
  const classifications: Role[][] = [[judgeRole], [stewardRole], [judgeRole, stewardRole], [veterinarianRole]];
  for (let index = 0; index < classifications.length; index += 1) {
    await resetIdoc();
    const roles = classifications[index];
    const user = await createUser('onboarding');
    await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(profileInput(roles)));
    const created = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => getOwnPrivateMember());
    assertRolesMatchExactly(created?.roles, roles, `create:${roles.map((r) => r.roleType).join('+')}`);

    // Rotate to the next classification so every classification in this list is exercised as
    // both a creation target (above) and an edit destination (below) across the full loop.
    const otherRoles = classifications[(index + 1) % classifications.length];
    await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => updateMemberProfile(created!.profile.id, profileInput(otherRoles)));
    const edited = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => getOwnPrivateMember());
    assertRolesMatchExactly(edited?.roles, otherRoles, `edit:${roles.map((r) => r.roleType).join('+')}->${otherRoles.map((r) => r.roleType).join('+')}`);
  }
});

test('optional Address 2 normalizes empty and whitespace-only input to null and trims a provided value', async () => {
  const cases: Array<{ input: string | undefined; expected: string | null }> = [
    { expected: null, input: '' },
    { expected: null, input: '   ' },
    { expected: null, input: undefined },
    { expected: 'Suite 5', input: '  Suite 5  ' },
  ];
  for (const { input, expected } of cases) {
    await resetIdoc();
    const user = await createUser('onboarding');
    await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile({ ...profileInput(), address2: input }));
    const [row] = await sql`select address_2 from idoc.profiles where user_id=${user.id}`;
    assert.equal(row.address_2, expected, JSON.stringify(input));
  }
});

test('required text fields are trimmed before persistence', async () => {
  const user = await createUser('onboarding');
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile({
    ...profileInput(), address1: '  1 Test Road  ', city: '  Test City  ', firstName: '  Jane  ',
    lastName: '  Doe  ', postalCode: '  10115  ', stateProvince: '  Berlin  ',
  }));
  const [row] = await sql`select first_name,last_name,address_1,city,state_province,postal_code from idoc.profiles where user_id=${user.id}`;
  assert.deepEqual(row, {
    address_1: '1 Test Road', city: 'Test City', first_name: 'Jane',
    last_name: 'Doe', postal_code: '10115', state_province: 'Berlin',
  });
});

test('missing or whitespace-only required fields are rejected without mutation on create and edit', async () => {
  const requiredFields = ['address1', 'city', 'firstName', 'lastName', 'postalCode', 'stateProvince'] as const;
  for (const field of requiredFields) {
    for (const badValue of ['', '   ', undefined]) {
      await resetIdoc();
      const onboardingUser = await createUser('onboarding');
      await assert.rejects(withTestMembershipBoundary(
        { actor: { id: onboardingUser.id, roles: [] } },
        () => createOwnMemberProfile({ ...profileInput(), [field]: badValue }),
      ), `create:${field}:${JSON.stringify(badValue)}`);
      assert.equal((await sql`select 1 from idoc.profiles where user_id=${onboardingUser.id}`).length, 0);

      await resetIdoc();
      const editUser = await createUser();
      const profile = await createProfile(editUser.id);
      await createMembership(profile.id);
      const before = await persistedGraph(editUser.id);
      await assert.rejects(withTestMembershipBoundary(
        { actor: { id: editUser.id, roles: [] } },
        () => updateMemberProfile(profile.id, { ...profileInput(), [field]: badValue }),
      ), `edit:${field}:${JSON.stringify(badValue)}`);
      assert.deepEqual(await persistedGraph(editUser.id), before);
    }
  }
});

test('malformed field types are rejected without mutation on create and edit', async () => {
  const malformed = [
    { ...profileInput(), firstName: 12_345 },
    { ...profileInput(), address1: null },
    { ...profileInput(), roles: 'judge' },
    { ...profileInput(), postalCode: {} },
    { ...profileInput(), city: [] },
    { ...profileInput(), countryCode: 123 },
    { ...profileInput(), roles: [{ ...judgeRole, isTechnicalDelegate: 'yes' }] },
    { ...profileInput(), roles: [{ ...judgeRole, feiId: 42 }] },
  ];
  for (const payload of malformed) {
    await resetIdoc();
    const onboardingUser = await createUser('onboarding');
    await assert.rejects(withTestMembershipBoundary(
      { actor: { id: onboardingUser.id, roles: [] } },
      () => createOwnMemberProfile(payload),
    ), `create:${JSON.stringify(payload)}`);
    assert.equal((await sql`select 1 from idoc.profiles where user_id=${onboardingUser.id}`).length, 0);

    await resetIdoc();
    const editUser = await createUser();
    const profile = await createProfile(editUser.id);
    await createMembership(profile.id);
    const before = await persistedGraph(editUser.id);
    await assert.rejects(withTestMembershipBoundary(
      { actor: { id: editUser.id, roles: [] } },
      () => updateMemberProfile(profile.id, payload),
    ), `edit:${JSON.stringify(payload)}`);
    assert.deepEqual(await persistedGraph(editUser.id), before);
  }
});

test('a status value from another classification cannot be assigned across roles', async () => {
  const judgeStatus = judgeRole.officialStatus;
  const stewardStatus = stewardRole.officialStatus;
  const cases = [
    { ...profileInput(), roles: [{ ...stewardRole, officialStatus: judgeStatus }] },
    { ...profileInput(), roles: [{ ...judgeRole, officialStatus: stewardStatus }] },
  ];
  for (const payload of cases) {
    const user = await createUser('onboarding');
    await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(payload)));
    assert.equal((await sql`select 1 from idoc.profiles where user_id=${user.id}`).length, 0);
    await resetIdoc();
  }
});

test('Veterinarian restrictions reject every foundation field the classification does not carry', async () => {
  const forbidden = [
    { feiId: judgeRole.feiId },
    { idocRegion: judgeRole.idocRegion },
    { nationalFederationCountryCode: judgeRole.nationalFederationCountryCode },
    { officialStatus: judgeRole.officialStatus },
    { isTechnicalDelegate: false },
  ];
  for (const extra of forbidden) {
    const user = await createUser('onboarding');
    const payload = { ...profileInput(), roles: [{ roleType: 'veterinarian' as const, ...extra }] };
    await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(payload)), JSON.stringify(extra));
    assert.equal((await sql`select 1 from idoc.profiles where user_id=${user.id}`).length, 0);
    await resetIdoc();
  }
});

test('the classification list rejects duplicates, unsupported combinations, and more than two roles', async () => {
  const invalidCombinations = [
    [judgeRole, judgeRole],
    [stewardRole, veterinarianRole],
    [judgeRole, veterinarianRole],
    [judgeRole, stewardRole, veterinarianRole],
    [],
  ];
  for (const roles of invalidCombinations) {
    const user = await createUser('onboarding');
    await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(profileInput(roles as never))), JSON.stringify(roles.map((r) => r.roleType)));
    assert.equal((await sql`select 1 from idoc.profiles where user_id=${user.id}`).length, 0);
    await resetIdoc();
  }
});

test('invalid federation, region, FEI ID, official status, and country values are rejected for every classification that carries them', async () => {
  const cases = [
    // National federation: Judge alone, Steward alone, and Steward's half of Judge + Steward.
    { ...profileInput(), roles: [{ ...judgeRole, nationalFederationCountryCode: 'XX' }] },
    { ...profileInput(), roles: [{ ...stewardRole, nationalFederationCountryCode: 'XX' }] },
    { ...profileInput(), roles: [judgeRole, { ...stewardRole, nationalFederationCountryCode: 'XX' }] },
    // IDOC region.
    { ...profileInput(), roles: [{ ...judgeRole, idocRegion: 'Invented Region' }] },
    { ...profileInput(), roles: [{ ...stewardRole, idocRegion: 'Invented Region' }] },
    { ...profileInput(), roles: [judgeRole, { ...stewardRole, idocRegion: 'Invented Region' }] },
    // FEI ID.
    { ...profileInput(), roles: [{ ...judgeRole, feiId: '' }] },
    { ...profileInput(), roles: [{ ...stewardRole, feiId: '' }] },
    { ...profileInput(), roles: [judgeRole, { ...stewardRole, feiId: '' }] },
    // Official status.
    { ...profileInput(), roles: [{ ...judgeRole, officialStatus: 'Invented Judge Status' }] },
    { ...profileInput(), roles: [{ ...stewardRole, officialStatus: 'Invented Steward Status' }] },
    { ...profileInput(), roles: [judgeRole, { ...stewardRole, officialStatus: 'Invented Steward Status' }] },
    // Country (a top-level field, independent of classification): Steward and Veterinarian payloads,
    // not only the default Judge payload used elsewhere in this file.
    { ...profileInput(), countryCode: 'XX', roles: [stewardRole] },
    { ...profileInput(), countryCode: 'XX', roles: [veterinarianRole] },
  ];
  for (const payload of cases) {
    await resetIdoc();
    const user = await createUser('onboarding');
    await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(payload)), JSON.stringify(payload));
    assert.equal((await sql`select 1 from idoc.profiles where user_id=${user.id}`).length, 0);
  }
});
