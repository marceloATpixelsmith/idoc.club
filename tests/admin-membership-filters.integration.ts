import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { listAdminMembers } from '../lib/membership/admin-memberships.ts';
import { asAdmin, adminUser, closeHarness, createMembership, createProfile, createUser, judgeRole, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('admin member search: an array-valued (repeated-key) query parameter is treated as its first value instead of crashing -- a real Next.js searchParams shape', async () => {
  const admin = await adminUser();
  const user = await createUser();
  const profile = await createProfile(user.id);
  await createMembership(profile.id);

  // Simulates a real ?country=DE&country=FR request: Next.js hands this to the page as an array.
  const listing = await asAdmin(admin.id, () => listAdminMembers({
    country: ['DE', 'FR'], federation: ['DE', 'PL'], page: ['1', '2'], q: [''], sort: ['name_asc', 'name_desc'], status: ['active', 'expired'],
  }));
  assert.equal(listing.filters.page, 1);
  assert.equal(listing.filters.country, 'DE');
  assert.equal(listing.filters.status, 'active');
  assert.ok(listing.rows.some((row) => row.profileId === profile.id));
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
