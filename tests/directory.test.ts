import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const aggregateSource = readFileSync('lib/directory/aggregate.ts', 'utf8');
const memberDirectorySource = readFileSync('lib/directory/member-directory.ts', 'utf8');
const rateLimitSource = readFileSync('lib/security/rate-limit.ts', 'utf8');
const concentrationMapSource = readFileSync('components/directory/concentration-map.tsx', 'utf8');
const publicPageSource = readFileSync('app/(marketing)/about/members-directory/page.tsx', 'utf8');
const memberPageSource = publicPageSource;
const dashboardTabs = readFileSync('app/(dashboard)/dashboard/dashboard-tabs.tsx', 'utf8');

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

test('the paid member directory never selects or returns a name-adjacent contact field, exact address, or database identifier', () => {
  const select = memberDirectorySource.slice(memberDirectorySource.indexOf('select p.first_name'), memberDirectorySource.indexOf('${from} where ${where} order'));
  assert.doesNotMatch(select, /email|address|postal_code|"id"|profileId|userId|\bu\.\w/i);
});

test('directory pagination uses a fixed, server-controlled page size and a bounded maximum page, never a client-supplied page size', () => {
  assert.match(memberDirectorySource, /export const DIRECTORY_PAGE_SIZE = 25/);
  assert.match(memberDirectorySource, /export const DIRECTORY_MAX_PAGE = 200/);
  assert.doesNotMatch(memberDirectorySource, /pageSize.*=.*input\.|input\.pageSize/);
  assert.match(memberDirectorySource, /Math\.min\(page, DIRECTORY_MAX_PAGE\)/);
  assert.match(memberDirectorySource, /Math\.min\(counts\[0\]\?\.count \?\? 0, DIRECTORY_MAX_PAGE \* DIRECTORY_PAGE_SIZE\)/);
});

test('directory search input length is capped, and search/filter values are escaped before use in a LIKE pattern', () => {
  assert.match(memberDirectorySource, /firstString\(input\.q\)\?\.trim\(\)\.slice\(0, 100\)/);
  assert.match(memberDirectorySource, /replaceAll\('%', '\\\\%'\)\.replaceAll\('_', '\\\\_'\)/);
});

test('ordering is stable across pages: name first, then a non-exposed internal id as a pure tiebreaker', () => {
  assert.match(memberDirectorySource, /p\.last_name asc, p\.first_name asc, p\.id asc/);
});

test('the website directory keeps unauthorized and failure states generic', () => {
  assert.match(memberPageSource, /Active membership required/);
  assert.match(memberPageSource, /DirectoryRateLimitedError/);
  assert.match(memberPageSource, /directory could not be loaded/i);
});

test('the paid directory page never renders a database identifier and uses only the row position as a React key', () => {
  assert.doesNotMatch(memberPageSource, /row\.id\b|row\.profileId|row\.userId/);
  assert.match(memberPageSource, /key=\{index\}/);
});

test('every documented filter (membership type, federation, country, region) is present as a real form control', () => {
  for (const name of ['q', 'membershipType', 'country', 'federation', 'region']) {
    assert.match(memberPageSource, new RegExp(`name="${name}"`));
  }
});

test('no Server Action or CSRF token is used by the directory surfaces: both are pure, re-authorized-on-every-request reads', () => {
  for (const source of [aggregateSource, memberDirectorySource, memberPageSource, publicPageSource]) {
    assert.doesNotMatch(source, /'use server'|requireCsrfToken/);
  }
  assert.match(memberPageSource, /form method="get"/);
});

test('the dashboard navigation omits Directory while the public website retains it', () => {
  assert.doesNotMatch(dashboardTabs, /\/dashboard\/directory|label: 'Directory'/);
  assert.match(publicPageSource, /Search Directory/);
});

test('the entitled-member directory defaults to the privacy-safe map and searches only on the explicit second tab', () => {
  assert.match(memberPageSource, /activeTab = first\(params\.tab\) === 'directory' \? 'directory' : 'map'/);
  assert.match(memberPageSource, /Map \/ Infographic/);
  assert.match(memberPageSource, /Search Directory/);
  assert.match(memberPageSource, /if \(activeTab === 'directory' && user\)/);
  assert.match(memberPageSource, /getPublicMemberConcentration/);
});

test('directory filters resolve an array-valued (repeated-key) search parameter to "absent" before calling any string method on it', () => {
  assert.match(memberDirectorySource, /function firstString\(value: RawFilterValue\): string \| undefined \{\s*\n\s*return Array\.isArray\(value\) \? undefined : value;/);
  // Every filter field normalized() reads goes through firstString first, not a bare `.trim()`
  // straight off the raw input -- the actual finding this fixes was `input.country?.trim()`
  // throwing when `country` was an array.
  for (const field of ['country', 'federation', 'membershipType', 'q', 'region']) {
    assert.match(memberDirectorySource, new RegExp(`firstString\\(input\\.${field}\\)`));
  }
});

test('the paid directory page never passes a possibly-array searchParams value straight into a form field default', () => {
  assert.match(memberPageSource, /function first\(value: string \| string\[\] \| undefined\) \{\s*\n\s*return Array\.isArray\(value\) \? undefined : value;/);
  for (const field of ['q', 'membershipType', 'country', 'federation', 'region']) {
    assert.match(memberPageSource, new RegExp(`first\\(params\\.${field}\\)`));
  }
});

test('the public map page forces per-request dynamic rendering so it cannot be frozen as a static build-time snapshot', () => {
  assert.match(publicPageSource, /export const dynamic = 'force-dynamic';/);
});
