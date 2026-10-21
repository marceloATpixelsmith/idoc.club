import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { listAdminMembers } from '../lib/membership/admin-memberships.ts';
import { asAdmin, adminUser, closeHarness, createMembership, createProfile, createUser, judgeRole, resetIdoc, sql, stewardRole } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('admin member search: a repeated-key query parameter is treated as a real multi-select instead of crashing -- a real Next.js searchParams shape', async () => {
  const admin = await adminUser();
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);

  // Legacy address-country input is ignored; federation remains a supported multi-select.
  const listing = await asAdmin(admin.id, () => listAdminMembers({
    filters: JSON.stringify([{ id: 'country', operator: 'eq', value: 'DE' }]), federation: ['DE', 'PL'], page: ['1', '2'], q: [''], sort: ['name_asc', 'name_desc'], status: ['active', 'expired'],
  }));
  assert.equal(listing.filters.page, 1);
  assert.deepEqual(listing.filters.federations, ['DE', 'PL']);
  assert.deepEqual(listing.filters.statuses, ['active', 'expired']);
  assert.ok(listing.rows.some((row) => row.profileId === profile.id));
});

test('admin member search: a comma-joined single query param (the multi-select toolbar\'s actual shape) matches any selected value', async () => {
  const admin = await adminUser();
  const first = await createUser();
  const firstProfile = await createProfile(first.id);
  await createMembership(firstProfile.id);
  const second = await createUser();
  const secondProfile = await createProfile(second.id);
  await createMembership(secondProfile.id, false);

  const listing = await asAdmin(admin.id, () => listAdminMembers({ status: 'active,expired' }));
  assert.deepEqual(listing.filters.statuses, ['active', 'expired']);
  const profileIds = listing.rows.map((row) => row.profileId);
  assert.ok(profileIds.includes(firstProfile.id));
  assert.ok(profileIds.includes(secondProfile.id));
});

test('an absent status filter shows every status -- listAdminMembers itself no longer defaults to active-only', async () => {
  // The active-by-default view a brand-new administrator sees is applied once, by the page itself,
  // only when no table preference has ever been saved (app/(dashboard)/admin/members/page.tsx).
  // listAdminMembers must not re-apply that default on its own: doing so previously made Reset
  // unable to actually clear the Status filter, since a cleared filter and a never-set one both
  // arrive here as an absent `status`.
  const admin = await adminUser();
  const activeUser = await createUser();
  const activeProfile = await createProfile(activeUser.id);
  await createMembership(activeProfile.id, true);
  const expiredUser = await createUser();
  const expiredProfile = await createProfile(expiredUser.id);
  await createMembership(expiredProfile.id, false);

  const listing = await asAdmin(admin.id, () => listAdminMembers({}));
  assert.deepEqual(listing.filters.statuses, []);
  const profileIds = listing.rows.map((row) => row.profileId);
  assert.ok(profileIds.includes(activeProfile.id));
  assert.ok(profileIds.includes(expiredProfile.id));
});

test('membership filters apply federation, region, status exclusions and multiple sort priorities to real rows', async () => {
  const admin = await adminUser();
  const first = await createUser();
  const firstProfile = await createProfile(first.id, [judgeRole]);
  await createMembership(firstProfile.id);
  await sql`update idoc.profiles set last_name='Zulu' where id=${firstProfile.id}`;
  const second = await createUser();
  const secondProfile = await createProfile(second.id, [judgeRole]);
  await createMembership(secondProfile.id);
  await sql`update idoc.profiles set last_name='Alpha' where id=${secondProfile.id}`;
  const expired = await createUser();
  const expiredProfile = await createProfile(expired.id, [judgeRole]);
  await createMembership(expiredProfile.id, false);
  await sql`update idoc.profiles set country_code='PL' where id=${expiredProfile.id}`;
  await sql`update idoc.professional_roles set national_federation_country_code='PL',idoc_region='Central & Eastern Europe' where profile_id=${expiredProfile.id}`;

  const listed = await asAdmin(admin.id, () => listAdminMembers({
    filters: JSON.stringify([
      { id: 'federation', operator: 'eq', value: 'DE' },
      { id: 'region', operator: 'eq', value: 'Western Europe & Africa' },
    ]),
    sort: JSON.stringify([{ id: 'federation', desc: false }, { id: 'name', desc: true }]),
  }));
  assert.deepEqual(listed.rows.map((row) => row.profileId), [firstProfile.id, secondProfile.id]);

  const excluded = await asAdmin(admin.id, () => listAdminMembers({ filters: JSON.stringify([
    { id: 'status', operator: 'ne', value: 'active' },
  ]) }));
  assert.deepEqual(excluded.rows.map((row) => row.profileId), [expiredProfile.id]);

  const combined = await asAdmin(admin.id, () => listAdminMembers({
    filters: JSON.stringify([
      { id: 'federation', operator: 'eq', value: 'DE' },
    ]), joinOperator: 'or', status: 'active',
  }));
  assert.deepEqual(combined.rows.map((row) => row.profileId).sort(), [firstProfile.id, secondProfile.id].sort());
});

test('descending member-name sorting reverses first names when last names match', async () => {
  const admin = await adminUser();
  const alice = await createUser();
  const aliceProfile = await createProfile(alice.id);
  await createMembership(aliceProfile.id);
  await sql`update idoc.profiles set first_name='Alice',last_name='Smith' where id=${aliceProfile.id}`;
  const zoe = await createUser();
  const zoeProfile = await createProfile(zoe.id);
  await createMembership(zoeProfile.id);
  await sql`update idoc.profiles set first_name='Zoe',last_name='Smith' where id=${zoeProfile.id}`;

  const listing = await asAdmin(admin.id, () => listAdminMembers({ sort: JSON.stringify([{ id: 'name', desc: true }]) }));
  assert.deepEqual(listing.rows.map((row) => row.profileId), [zoeProfile.id, aliceProfile.id]);
});

test('the Official Status filter matches members holding any selected Judge or Steward status, and the same label under the other role does not collide', async () => {
  const admin = await adminUser();
  const judge = await createUser();
  const judgeProfile = await createProfile(judge.id, [{ ...judgeRole, officialStatuses: ['FEI Dressage Judge 3/4*', 'Other'] as never }]);
  await createMembership(judgeProfile.id);
  const steward = await createUser();
  const stewardProfile = await createProfile(steward.id, [{ ...stewardRole, officialStatuses: ['National Dressage Steward'] as never }]);
  await createMembership(stewardProfile.id);
  const other = await createUser();
  const otherProfile = await createProfile(other.id, [{ ...stewardRole, officialStatuses: ['Other'] as never }]);
  await createMembership(otherProfile.id);

  const judgeOnly = await asAdmin(admin.id, () => listAdminMembers({ officialStatus: 'judge:FEI Dressage Judge 3/4*' }));
  assert.deepEqual(judgeOnly.rows.map((row) => row.profileId), [judgeProfile.id]);
  assert.deepEqual(judgeOnly.rows[0].officialStatuses, ['judge:FEI Dressage Judge 3/4*', 'judge:Other']);

  const either = await asAdmin(admin.id, () => listAdminMembers({ officialStatus: 'judge:FEI Dressage Judge 3/4*,steward:National Dressage Steward' }));
  assert.deepEqual(either.rows.map((row) => row.profileId).sort(), [judgeProfile.id, stewardProfile.id].sort());

  // "Other" exists in both lists: the role prefix keeps the Judge's "Other" from matching a Steward's.
  const stewardOther = await asAdmin(admin.id, () => listAdminMembers({ officialStatus: 'steward:Other' }));
  assert.deepEqual(stewardOther.rows.map((row) => row.profileId), [otherProfile.id]);

  // An unknown token is ignored rather than widening or breaking the query.
  const unknown = await asAdmin(admin.id, () => listAdminMembers({ officialStatus: 'judge:Not A Status' }));
  assert.deepEqual(unknown.filters.officialStatuses, []);
});

test('admin member search matches first name, last name, full name and displayed email, and pages stay ordered and complete', async () => {
  const admin = await adminUser();
  const members: { id: number; lastName: string }[] = [];
  for (const [first, last] of [['Anna', 'Zeta'], ['Bruno', 'Alpha'], ['Carla', 'Mid'], ['Dora', 'Alpha']]) {
    const user = await createUser();
    const profile = await createProfile(user.id);
    await sql`update idoc.profiles set first_name=${first}, last_name=${last} where id=${profile.id}`;
    await createMembership(profile.id);
    members.push({ id: profile.id, lastName: last });
  }
  const [anna, bruno, carla, dora] = members;
  const search = async (q: string) => (await asAdmin(admin.id, () => listAdminMembers({ q }))).rows.map((row) => row.profileId);

  assert.deepEqual(await search('anna'), [anna.id], 'first name, case-insensitive');
  assert.deepEqual(await search('ALPH'), [bruno.id, dora.id], 'last name; ties on last name sort by first name');
  assert.deepEqual(await search('Carla Mid'), [carla.id], 'full name');
  assert.deepEqual(await search('no-such-member'), []);
  const [{ email }] = await sql<{ email: string }[]>`select u.email from idoc.users u join idoc.profiles p on p.user_id=u.id where p.id=${dora.id}`;
  await sql`update idoc.users set email_display=${`Dora.Display@Example.test`} where email=${email}`;
  assert.deepEqual(await search('dora.display@EXAMPLE'), [dora.id], 'displayed email, case-insensitive');
  assert.deepEqual(await search('50%_'), [], 'LIKE wildcards in the search text are literal');

  // Default Name sort across pages: the page query now finds the page's ids first, then loads the rows.
  const everyone = (await asAdmin(admin.id, () => listAdminMembers({ pageSize: 100 }))).rows.map((row) => row.profileId);
  assert.deepEqual(everyone, [bruno.id, dora.id, carla.id, anna.id], 'last name, then first name');
  const paged = [];
  for (const page of [1, 2]) {
    const listing = await asAdmin(admin.id, () => listAdminMembers({ page, pageSize: 10 }));
    paged.push(...listing.rows.map((row) => row.profileId));
    assert.equal(listing.total, 4);
  }
  assert.deepEqual(paged, everyone);
});

test('admin member list: a payment-date sort pages correctly and every column is still populated on a paged result', async () => {
  const admin = await adminUser();
  const ids: number[] = [];
  for (const paidAt of ['2026-01-01', '2026-03-01', '2026-02-01']) {
    const user = await createUser();
    const profile = await createProfile(user.id);
    await createMembership(profile.id);
    await sql`insert into idoc.payments(profile_id,source,amount_cents,paid_at,administrator_id,reason) values(${profile.id},'cash',5000,${paidAt},${admin.id},'test')`;
    ids.push(profile.id);
  }
  const sort = JSON.stringify([{ id: 'lastPayment', desc: true }]);
  const first = await asAdmin(admin.id, () => listAdminMembers({ page: 1, pageSize: 10, sort }));
  assert.deepEqual(first.rows.map((row) => row.profileId), [ids[1], ids[2], ids[0]]);
  assert.ok(first.rows.every((row) => row.lastPaymentAt && row.membershipType && row.validUntil && row.status === 'active'));
  assert.equal(first.total, 3);
});
