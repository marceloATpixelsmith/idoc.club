import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { listAdminMembers } from '../lib/membership/admin-memberships.ts';
import { asAdmin, adminUser, closeHarness, createMembership, createProfile, createUser, judgeRole, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('admin member search: a repeated-key query parameter is treated as a real multi-select instead of crashing -- a real Next.js searchParams shape', async () => {
  const admin = await adminUser();
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);

  // Simulates a real ?country=DE&country=FR request: Next.js hands this to the page as an array.
  // Scalar filters (page, sort, q) still resolve to their first value; multi-select filters
  // (country, federation, status) now match ANY of the repeated values.
  const listing = await asAdmin(admin.id, () => listAdminMembers({
    country: ['DE', 'FR'], federation: ['DE', 'PL'], page: ['1', '2'], q: [''], sort: ['name_asc', 'name_desc'], status: ['active', 'expired'],
  }));
  assert.equal(listing.filters.page, 1);
  assert.deepEqual(listing.filters.countries, ['DE', 'FR']);
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

test('membership filters apply selectable country, federation, region, status exclusions and multiple sort priorities to real rows', async () => {
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
      { id: 'country', operator: 'eq', value: 'DE' },
      { id: 'federation', operator: 'eq', value: 'DE' },
      { id: 'region', operator: 'eq', value: 'Western Europe & Africa' },
    ]),
    sort: JSON.stringify([{ id: 'federation', desc: false }, { id: 'name', desc: true }]),
  }));
  assert.deepEqual(listed.rows.map((row) => row.profileId), [firstProfile.id, secondProfile.id]);

  const excluded = await asAdmin(admin.id, () => listAdminMembers({ filters: JSON.stringify([
    { id: 'status', operator: 'ne', value: 'active' },
    { id: 'country', operator: 'eq', value: 'PL' },
  ]) }));
  assert.deepEqual(excluded.rows.map((row) => row.profileId), [expiredProfile.id]);

  const combined = await asAdmin(admin.id, () => listAdminMembers({
    filters: JSON.stringify([
      { id: 'country', operator: 'eq', value: 'PL' },
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
