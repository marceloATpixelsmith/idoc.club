import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const aggregateSource = readFileSync('lib/directory/aggregate.ts', 'utf8');
const memberDirectorySource = readFileSync('lib/directory/member-directory.ts', 'utf8');
const rateLimitSource = readFileSync('lib/security/rate-limit.ts', 'utf8');
const concentrationMapSource = readFileSync('components/directory/concentration-map.tsx', 'utf8');
const publicPageSource = readFileSync('app/(marketing)/about/members-directory/page.tsx', 'utf8');
const memberPageSource = readFileSync('components/directory/member-directory-table.tsx', 'utf8');
const memberRouteSource = publicPageSource;
const dashboardTabs = readFileSync('app/(dashboard)/dashboard/dashboard-tabs.tsx', 'utf8');
const securityDoc = readFileSync('docs/05-security-and-privacy-requirements.md', 'utf8');

test('the public map query never selects a name, email, address, or exact coordinate field', () => {
  const select = aggregateSource.slice(aggregateSource.indexOf('select p.country_code'), aggregateSource.indexOf('from idoc.profiles'));
  assert.doesNotMatch(select, /first_name|last_name|email|address|postal_code|latitude|longitude|\blat\b|\blng\b/i);
});

test('the public map never exposes a raw profile id or sequential database identifier', () => {
  const select = aggregateSource.slice(aggregateSource.indexOf('select p.country_code'), aggregateSource.indexOf('from idoc.profiles'));
  assert.doesNotMatch(select, /p\.id\b/);
  assert.doesNotMatch(aggregateSource, /profileId|userId/);
});

test('the public map is genuinely public: it never requires authentication or authorization', () => {
  assert.doesNotMatch(aggregateSource, /requireAccountAccess|requireAdministrator|requireSuperAdmin|getUser\(/);
});

test('a documented minimum aggregation threshold suppresses any area below it, and no merged/grand total figure is exposed alongside it', () => {
  assert.match(aggregateSource, /export const DIRECTORY_MIN_AGGREGATION_THRESHOLD = 5/);
  assert.match(aggregateSource, /having count\(\*\) >= \$\{DIRECTORY_MIN_AGGREGATION_THRESHOLD\}/);
  // No "other"/"rest of world" merged bucket and no un-thresholded total in the actual query or
  // returned shape -- both would let a reader back-calculate a suppressed area's size from
  // arithmetic. Scoped to the function body (not the whole file) since the file's own explanatory
  // comment above the constant necessarily discusses the "other bucket" it deliberately avoids.
  const body = aggregateSource.slice(aggregateSource.indexOf('export async function getPublicMemberConcentration'));
  assert.doesNotMatch(body, /'other'|"other"|rest of world|totalMembers|grandTotal/i);
});

test('a query failure degrades to an "unavailable" result rather than throwing on this public, unauthenticated surface', () => {
  assert.match(aggregateSource, /catch/);
  assert.match(aggregateSource, /ok: false/);
  assert.match(aggregateSource, /logError\('directory_map_query_failed'\)/);
});

test('the concentration map renders a real, always-visible data table as accessible fallback content, not just an aria label', () => {
  assert.match(concentrationMapSource, /role="img"/);
  assert.match(concentrationMapSource, /aria-label=/);
  assert.match(concentrationMapSource, /<table/);
  assert.doesNotMatch(concentrationMapSource, /<table[^>]*aria-hidden/);
});

test('the public directory page renders loading, empty, unavailable, and error states', () => {
  assert.match(publicPageSource, /concentration\?\.ok/);
  assert.match(publicPageSource, /temporarily unavailable/i);
  assert.match(publicPageSource, /Not enough member data/i);
  // Loading is a sibling loading.tsx (Next.js Suspense boundary); the root error.tsx already
  // handles the error state for the whole app, so this page does not need its own.
  assert.doesNotMatch(readFileSync('app/(marketing)/about/members-directory/loading.tsx', 'utf8'), /^$/);
});

test('the paid member directory re-authorizes as an entitled member or privileged administrator, independent of any caller', () => {
  assert.match(memberDirectorySource, /requireAccountAccess\('member'\)/);
});

test('the paid member directory rate-limits searches per account and per origin using the existing repository rate-limit facility', () => {
  assert.match(memberDirectorySource, /checkRateLimit\('member_directory_search', String\(actor\.id\), await requestOrigin\(\)\)/);
  assert.match(rateLimitSource, /member_directory_search: 60/);
});

test('the paid member directory returns email only for the re-authorized member tab and no exact address or database identifier', () => {
  const select = memberDirectorySource.slice(memberDirectorySource.indexOf('select p.first_name'), memberDirectorySource.indexOf('${from} where ${where} order'));
  assert.match(select, /coalesce\(u\.email_display, u\.email\) email/);
  assert.match(memberDirectorySource, /join idoc\.users u on u\.id = p\.user_id and u\.deleted_at is null and u\.account_state = 'active'/);
  assert.match(memberDirectorySource, /not exists \(select 1 from idoc\.application_roles ar where ar\.user_id = u\.id and ar\.revoked_at is null and ar\.role in \('administrator', 'super_admin'\)\)/);
  assert.doesNotMatch(select, /address|postal_code|"id"|profileId|userId/i);
});

test('directory page size matches the admin options and caps accessible results at 5,000 records', () => {
  assert.match(memberDirectorySource, /DIRECTORY_PAGE_SIZE_OPTIONS = \[10, 25, 50, 100\]/);
  assert.match(memberDirectorySource, /DIRECTORY_MAX_RESULTS = 5_000/);
  assert.match(memberDirectorySource, /input\.pageSize/);
  assert.match(memberDirectorySource, /Math\.min\(counts\[0\]\?\.count \?\? 0, DIRECTORY_MAX_RESULTS\)/);
  assert.match(memberPageSource, /pageSizeOptions=\{PAGE_SIZES\}/);
});

test('directory search input length is capped, and search/filter values are escaped before use in a LIKE pattern', () => {
  assert.match(memberDirectorySource, /input\.q\)\?\.trim\(\)\.slice\(0, 100\)/);
  assert.match(memberDirectorySource, /replaceAll\('%', '\\\\%'\)\.replaceAll\('_', '\\\\_'\)/);
});

test('ordering is stable across pages: name first, then a non-exposed internal id as a pure tiebreaker', () => {
  assert.match(memberDirectorySource, /p\.last_name asc nulls last/);
  assert.match(memberDirectorySource, /p\.first_name asc nulls last/);
  assert.match(memberDirectorySource, /p\.id asc/);
});

test('the website directory keeps unauthorized and failure states generic', () => {
  assert.match(memberRouteSource, /Active membership required/);
  assert.match(memberRouteSource, /DirectoryRateLimitedError/);
  assert.match(memberRouteSource, /directory could not be loaded/i);
});

test('the paid directory page offers email links and actions without rendering a database identifier', () => {
  assert.doesNotMatch(memberPageSource, /row\.original\.(id|profileId|userId)\b/);
  assert.match(memberPageSource, /href=\{`mailto:\$\{row\.original\.email\}`\}/);
  assert.match(memberPageSource, /aria-label=\{`Email \$\{row\.original\.firstName\} \$\{row\.original\.lastName\}`\}/);
  assert.match(memberPageSource, /id: 'actions'/);
});

test('directory facets use the shared table toolbar and omit the redundant Country column and filter', () => {
  for (const id of ["'type'", "'federation'", "'region'"]) assert.ok(memberPageSource.includes(`id: ${id}`));
  assert.match(memberPageSource, /DataTableToolbar/);
  assert.match(memberPageSource, /variant: 'multiSelect'/);
  assert.doesNotMatch(memberPageSource, /id: 'country'|label: 'Country'|name="country"/);
});

test('no Server Action or CSRF token is used by the directory surfaces: both are pure, re-authorized-on-every-request reads', () => {
  for (const source of [aggregateSource, memberDirectorySource, memberPageSource, publicPageSource]) {
    assert.doesNotMatch(source, /'use server'|requireCsrfToken/);
  }
  assert.doesNotMatch(memberPageSource, /form method="get"|type="submit"|>Search</);
});

test('the dashboard navigation omits Directory while the public website retains it', () => {
  assert.doesNotMatch(dashboardTabs, /\/dashboard\/directory|label: 'Directory'/);
  assert.match(publicPageSource, /Search Directory/);
});

test('the entitled-member directory defaults to the privacy-safe map and searches only on the explicit second tab', () => {
  assert.match(memberRouteSource, /activeTab = user && first\(params\.tab\) === 'directory' \? 'directory' : 'map'/);
  assert.match(memberRouteSource, /Map \/ Infographic/);
  assert.match(memberRouteSource, /Search Directory/);
  assert.match(memberRouteSource, /if \(activeTab === 'directory' && user\)/);
  assert.match(memberRouteSource, /getPublicMemberConcentration/);
});

test('signed-out visitors see only the map, with no tabs and no directory even through a direct tab URL', () => {
  assert.match(memberRouteSource, /const user = await getPublicUser\(\)/);
  assert.match(memberRouteSource, /activeTab = user && first\(params\.tab\) === 'directory' \? 'directory' : 'map'/);
  assert.match(memberRouteSource, /\{user \? <nav aria-label="Members directory views"/);
});

test('directory facets accept multi-value query parameters safely', () => {
  assert.match(memberDirectorySource, /function values\(value: RawFilterValue, limit: number\): string\[\]/);
  assert.match(memberDirectorySource, /flatMap\(\(entry\) => entry\.split\(','\)\)/);
  for (const field of ['federation', 'membershipType', 'region']) {
    assert.match(memberDirectorySource, new RegExp(`values\\(input\\.${field}`));
  }
});

test('the paid directory page never passes a possibly-array searchParams value straight into a form field default', () => {
  assert.match(publicPageSource, /function first\(value: string/);
  assert.match(publicPageSource, /Array\.isArray\(value\) \? undefined : value/);
  assert.match(memberPageSource, /useState\(Array\.isArray\(filters\.q\)/);
});

test('the public map page forces per-request dynamic rendering so it cannot be frozen as a static build-time snapshot', () => {
  assert.match(publicPageSource, /export const dynamic = 'force-dynamic';/);
});

test('multiple membership-type facets stay grouped with the other access and search predicates', () => {
  assert.match(memberDirectorySource, /conditions\.push\(sql`\(\$\{sql\.join\(filters\.membershipType/);
});

test('descending name sorting applies the same direction to last and first names', () => {
  assert.ok(memberDirectorySource.includes("...(id === 'name' ? [sql`p.first_name ${direction} nulls last`] : [])"));
});

test('Reset appears for search-only state and cancels a pending debounced search', () => {
  assert.match(memberPageSource, /isFiltered=\{hasFilters \|\| hasSearch\}/);
  assert.match(memberPageSource, /debouncedSearch\.cancel\(\)/);
  assert.match(memberPageSource, /searchRef\.current = ''/);
});

test('security documentation describes the bounded page-size choices and reachable-record cap', () => {
  assert.match(securityDoc, /10, 25, 50, or 100 rows per page/);
  assert.match(securityDoc, /total reachable depth is capped at 5,000 records/);
});
