import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { AuthorizationError } from '../lib/membership/authorization.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { DIRECTORY_MAX_PAGE, DIRECTORY_PAGE_SIZE, DirectoryRateLimitedError, listMemberDirectory } from '../lib/directory/member-directory.ts';
import { DIRECTORY_MIN_AGGREGATION_THRESHOLD, getPublicMemberConcentration } from '../lib/directory/aggregate.ts';
import {
  adminUser, closeHarness, createMembership, createUser, judgeRole, resetIdoc, sql, stewardRole, veterinarianRole,
} from './postgres-harness.ts';

process.env.RATE_LIMIT_HASH_KEY = 'integration-rate-limit-secret-is-long-enough';

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

function asMember<T>(userId: number, operation: () => Promise<T>, origin = '203.0.113.5') {
  return withTestRequestCookies(new TestCookies(), () => withTestMembershipBoundary({ actor: { id: userId, roles: [] } }, operation), origin);
}

type RoleFixture = typeof judgeRole | typeof stewardRole | typeof veterinarianRole;

/** The shared harness's createProfile always uses country DE -- this test needs profiles spread
 * across several countries to exercise aggregation-threshold and country/federation/region
 * filtering, so it inserts directly (matching createProfile's own insert shape) with an overridable
 * country code and name. */
async function createProfileIn(userId: number, countryCode: string, roles: RoleFixture[] = [judgeRole], name = { firstName: 'Test', lastName: 'Member' }) {
  const [profile] = await sql<{ id: number }[]>`
    insert into idoc.profiles(user_id,first_name,last_name,address_1,city,state_province,postal_code,country_code)
    values(${userId},${name.firstName},${name.lastName},'1 Test Road','Test City','Region','10115',${countryCode}) returning id`;
  for (const role of roles) {
    await sql`insert into idoc.professional_roles(profile_id,role_type,national_federation_country_code,idoc_region,fei_id,official_statuses,is_technical_delegate)
      values(${profile.id},${role.roleType},${'nationalFederationCountryCode' in role ? role.nationalFederationCountryCode : null},${'idocRegion' in role ? role.idocRegion : null},${'feiId' in role ? role.feiId : null},${'officialStatuses' in role ? sql.array([...role.officialStatuses]) : null},${'isTechnicalDelegate' in role ? role.isTechnicalDelegate : null})`;
  }
  return profile;
}

async function entitledMemberIn(countryCode: string, roles: RoleFixture[] = [judgeRole], name?: { firstName: string; lastName: string }) {
  const user = await createUser();
  const profile = await createProfileIn(user.id, countryCode, roles, name);
  await createMembership(profile.id, true);
  return { profile, user };
}

beforeEach(resetIdoc);
after(closeHarness);

test('public map: an area below the documented minimum threshold is never rendered', async () => {
  for (let index = 0; index < DIRECTORY_MIN_AGGREGATION_THRESHOLD - 1; index += 1) await entitledMemberIn('FR');
  const result = await getPublicMemberConcentration();
  assert.ok(result.ok);
  assert.equal(result.areas.some((area) => area.countryCode === 'FR'), false);
});

test('public map: an area reaching the documented minimum threshold is rendered with its exact count', async () => {
  for (let index = 0; index < DIRECTORY_MIN_AGGREGATION_THRESHOLD; index += 1) await entitledMemberIn('DE');
  const result = await getPublicMemberConcentration();
  assert.ok(result.ok);
  const germany = result.areas.find((area) => area.countryCode === 'DE');
  assert.ok(germany);
  assert.equal(germany.memberCount, DIRECTORY_MIN_AGGREGATION_THRESHOLD);
});

test('public map: a below-threshold area is fully absent, not merged into any other area or a visible total', async () => {
  for (let index = 0; index < DIRECTORY_MIN_AGGREGATION_THRESHOLD; index += 1) await entitledMemberIn('DE');
  await entitledMemberIn('LI'); // one Liechtenstein member -- below threshold, must vanish entirely
  const result = await getPublicMemberConcentration();
  assert.ok(result.ok);
  assert.equal(result.areas.length, 1);
  assert.equal(result.areas[0].countryCode, 'DE');
  assert.equal(result.areas[0].memberCount, DIRECTORY_MIN_AGGREGATION_THRESHOLD);
});

test('public map: only currently-entitled members are counted, matching every other member surface\'s access rule', async () => {
  for (let index = 0; index < DIRECTORY_MIN_AGGREGATION_THRESHOLD; index += 1) await entitledMemberIn('DE');
  // Expired members in the same country must not inflate the count above the entitled total.
  for (let index = 0; index < 3; index += 1) {
    const user = await createUser();
    const profile = await createProfileIn(user.id, 'DE');
    await createMembership(profile.id, false);
  }
  const result = await getPublicMemberConcentration();
  assert.ok(result.ok);
  assert.equal(result.areas.find((area) => area.countryCode === 'DE')?.memberCount, DIRECTORY_MIN_AGGREGATION_THRESHOLD);
});

test('public map: each area exposes only a country code and a count -- nothing that could identify an individual', async () => {
  for (let index = 0; index < DIRECTORY_MIN_AGGREGATION_THRESHOLD; index += 1) await entitledMemberIn('DE');
  const result = await getPublicMemberConcentration();
  assert.ok(result.ok);
  assert.deepEqual(Object.keys(result.areas[0]).sort(), ['countryCode', 'memberCount']);
});

test('public map: requires no authentication or session at all', async () => {
  for (let index = 0; index < DIRECTORY_MIN_AGGREGATION_THRESHOLD; index += 1) await entitledMemberIn('DE');
  // Deliberately called with no withTestMembershipBoundary/session context whatsoever.
  const result = await getPublicMemberConcentration();
  assert.ok(result.ok);
});

test('paid directory: a never-paid member is denied, matching the same unpaid access rule as every other member surface', async () => {
  const user = await createUser();
  await createProfileIn(user.id, 'DE');
  await assert.rejects(() => asMember(user.id, () => listMemberDirectory()), AuthorizationError);
});

test('paid directory: an expired member is denied', async () => {
  const user = await createUser();
  const profile = await createProfileIn(user.id, 'DE');
  await createMembership(profile.id, false);
  await assert.rejects(() => asMember(user.id, () => listMemberDirectory()), AuthorizationError);
});

test('paid directory: a currently-entitled member can search, and a privileged administrator with no member profile can too', async () => {
  const { user } = await entitledMemberIn('DE');
  const listing = await asMember(user.id, () => listMemberDirectory());
  assert.ok(listing.rows.length >= 1);
  const admin = await adminUser();
  const asAdminListing = await asMember(admin.id, () => listMemberDirectory());
  assert.ok(asAdminListing.rows.length >= 1);
});

test('paid directory: never returns email, address, or any database identifier for any row', async () => {
  const { user } = await entitledMemberIn('DE', [judgeRole], { firstName: 'Ada', lastName: 'Lovelace' });
  const listing = await asMember(user.id, () => listMemberDirectory({ q: 'Lovelace' }));
  assert.equal(listing.rows.length, 1);
  assert.deepEqual(Object.keys(listing.rows[0]).sort(), ['country', 'federation', 'firstName', 'lastName', 'membershipType', 'region', 'roles'].sort());
});

test('paid directory: one member cannot see another member\'s private data through search -- results are limited to the documented public fields regardless of who searches', async () => {
  await entitledMemberIn('DE', [judgeRole], { firstName: 'Ada', lastName: 'Lovelace' });
  const { user: searcher } = await entitledMemberIn('FR', [stewardRole], { firstName: 'Grace', lastName: 'Hopper' });
  const listing = await asMember(searcher.id, () => listMemberDirectory({ q: 'Lovelace' }));
  assert.equal(listing.rows.length, 1);
  assert.equal(listing.rows[0].firstName, 'Ada');
  assert.deepEqual(Object.keys(listing.rows[0]).sort(), ['country', 'federation', 'firstName', 'lastName', 'membershipType', 'region', 'roles'].sort());
});

test('paid directory: filters by country, federation, region, and membership type', async () => {
  await entitledMemberIn('DE', [judgeRole], { firstName: 'Judge', lastName: 'One' });
  await entitledMemberIn('FR', [stewardRole], { firstName: 'Steward', lastName: 'Two' });
  await entitledMemberIn('ES', [veterinarianRole], { firstName: 'Vet', lastName: 'Three' });
  const { user: searcher } = await entitledMemberIn('IT', [judgeRole, stewardRole], { firstName: 'Combo', lastName: 'Four' });

  const byCountry = await asMember(searcher.id, () => listMemberDirectory({ country: 'DE' }));
  assert.deepEqual(byCountry.rows.map((row) => row.lastName), ['One']);

  const byFederation = await asMember(searcher.id, () => listMemberDirectory({ federation: judgeRole.nationalFederationCountryCode }));
  assert.ok(byFederation.rows.some((row) => row.lastName === 'One'));

  const byRegion = await asMember(searcher.id, () => listMemberDirectory({ region: stewardRole.idocRegion }));
  assert.ok(byRegion.rows.some((row) => row.lastName === 'Two'));

  const vets = await asMember(searcher.id, () => listMemberDirectory({ membershipType: 'veterinarian' }));
  assert.deepEqual(vets.rows.map((row) => row.lastName), ['Three']);

  const combos = await asMember(searcher.id, () => listMemberDirectory({ membershipType: 'combo' }));
  assert.deepEqual(combos.rows.map((row) => row.lastName), ['Four']);
});

test('paid directory: name search matches first or last name', async () => {
  const { user: searcher } = await entitledMemberIn('DE', [judgeRole], { firstName: 'Ada', lastName: 'Lovelace' });
  const byFirst = await asMember(searcher.id, () => listMemberDirectory({ q: 'ada' }));
  assert.equal(byFirst.rows.length, 1);
  const byLast = await asMember(searcher.id, () => listMemberDirectory({ q: 'lovelace' }));
  assert.equal(byLast.rows.length, 1);
  const noMatch = await asMember(searcher.id, () => listMemberDirectory({ q: 'nonexistent-name' }));
  assert.equal(noMatch.rows.length, 0);
});

test('paid directory: pagination is safe, bounded, and stable across pages with no duplicate or skipped rows', async () => {
  const names: { user: { id: number } }[] = [];
  for (let index = 0; index < DIRECTORY_PAGE_SIZE + 5; index += 1) {
    names.push(await entitledMemberIn('DE', [judgeRole], { firstName: 'Bulk', lastName: `Member-${String(index).padStart(3, '0')}` }));
  }
  const searcher = names[0].user;
  const page1 = await asMember(searcher.id, () => listMemberDirectory({ page: 1 }));
  const page2 = await asMember(searcher.id, () => listMemberDirectory({ page: 2 }));
  assert.equal(page1.rows.length, DIRECTORY_PAGE_SIZE);
  assert.equal(page2.rows.length, 5);
  const lastNames1 = page1.rows.map((row) => row.lastName);
  const lastNames2 = page2.rows.map((row) => row.lastName);
  assert.equal(new Set([...lastNames1, ...lastNames2]).size, DIRECTORY_PAGE_SIZE + 5);
  assert.equal(page1.total, DIRECTORY_PAGE_SIZE + 5);
});

test('paid directory: a page beyond the documented maximum is clamped, bounding deep-offset enumeration', async () => {
  const { user } = await entitledMemberIn('DE');
  const listing = await asMember(user.id, () => listMemberDirectory({ page: DIRECTORY_MAX_PAGE + 500 }));
  assert.equal(listing.filters.page, DIRECTORY_MAX_PAGE);
});

test('paid directory: sustained searching from one origin is rate-limited using the existing repository rate-limit facility', async () => {
  const { user } = await entitledMemberIn('DE');
  const origin = '198.51.100.9';
  for (let index = 0; index < 10; index += 1) {
    await asMember(user.id, () => listMemberDirectory(), origin);
  }
  await assert.rejects(() => asMember(user.id, () => listMemberDirectory(), origin), DirectoryRateLimitedError);
});

test('paid directory: an array-valued (repeated-key) query parameter is treated as absent instead of crashing -- a real Next.js searchParams shape', async () => {
  await entitledMemberIn('DE', [judgeRole], { firstName: 'Judge', lastName: 'One' });
  const { user: searcher } = await entitledMemberIn('FR', [stewardRole], { firstName: 'Steward', lastName: 'Two' });
  // Simulates a real ?country=DE&country=FR request: Next.js hands this to the page as an array.
  const listing = await asMember(searcher.id, () => listMemberDirectory({
    country: ['DE', 'FR'], federation: ['DE', 'PL'], membershipType: ['judge', 'steward'], page: ['1', '2'], q: ['One', 'Two'], region: ['Western Europe & Africa'],
  }));
  // Every array-valued filter fell back to "unset" rather than throwing, so this behaves like an
  // unfiltered browse (both fixtures visible) rather than a 500.
  assert.equal(listing.filters.page, 1);
  assert.equal(listing.filters.country, undefined);
  assert.ok(listing.rows.some((row) => row.lastName === 'One'));
  assert.ok(listing.rows.some((row) => row.lastName === 'Two'));
});
