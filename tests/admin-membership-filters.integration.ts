import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { listAdminMembers } from '../lib/membership/admin-memberships.ts';
import { asAdmin, adminUser, closeHarness, createMembership, createProfile, createUser, resetIdoc } from './postgres-harness.ts';

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
