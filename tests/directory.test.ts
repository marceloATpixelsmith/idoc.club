import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createQueryGate, DirectoryBusyError } from '../lib/directory/query-gate.ts';
import { COUNTRY_CENTROIDS } from '../lib/directory/country-centroids.ts';
import { buildMemberMapDots, dotRadius, MAP_DOT_MAX_RADIUS, MAP_DOT_MIN_RADIUS } from '../lib/directory/map-dots.ts';

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
  const select = aggregateSource.slice(aggregateSource.indexOf('select c.country_code'), aggregateSource.indexOf('from profiles'));
  assert.doesNotMatch(select, /first_name|last_name|email|address|postal_code|latitude|longitude|\blat\b|\blng\b/i);
});

test('the public map never exposes a raw profile id or sequential database identifier', () => {
  const select = aggregateSource.slice(aggregateSource.indexOf('select c.country_code'), aggregateSource.indexOf('from profiles'));
  assert.doesNotMatch(select, /p\.id\b/);
  assert.doesNotMatch(aggregateSource, /profileId|userId/);
});

test('the public map is genuinely public: it never requires authentication or authorization', () => {
  assert.doesNotMatch(aggregateSource, /requireAccountAccess|requireAdministrator|requireSuperAdmin|getUser\(/);
});

test('the documented minimum aggregation threshold is 1 (a single-member country is shown), and no merged/grand total figure is exposed', () => {
  assert.match(aggregateSource, /export const DIRECTORY_MIN_AGGREGATION_THRESHOLD = 1/);
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

test('the concentration map keeps a real, screen-reader-only data table as accessible content, not just an aria label', () => {
  assert.match(readFileSync('components/directory/member-map-canvas.tsx', 'utf8'), /role="img"/);
  assert.match(readFileSync('components/directory/member-map-canvas.tsx', 'utf8'), /aria-label=/);
  assert.match(concentrationMapSource, /<table/);
  assert.doesNotMatch(concentrationMapSource, /<table[^>]*aria-hidden/);
  assert.match(concentrationMapSource, /<div className="sr-only">\s*<table>/);
  assert.doesNotMatch(concentrationMapSource, /<figcaption/);
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
  assert.match(rateLimitSource, /const ORIGIN_MAX_REQUESTS[^{]*\{\s*member_directory_search: 180,/);
  assert.match(rateLimitSource, /takeBucket\(purpose, allEmailsMarker, originHash, windowStartedAt, originMax\)/);
});

test('the paid member directory returns email only for the re-authorized member tab and no exact address or database identifier', () => {
  const select = memberDirectorySource.slice(memberDirectorySource.indexOf('select p.id "profileId"'), memberDirectorySource.indexOf('${from} where ${where} order'));
  const liveSelect = memberDirectorySource.slice(memberDirectorySource.indexOf('async function liveDirectoryDetails'), memberDirectorySource.indexOf('const cachedDirectoryQuery'));
  // The email is returned only for members who opted in (default: not shown), and only from the live
  // per-page query; the cacheable select carries no email at all. Search and sort honor the same rule.
  assert.match(liveSelect, /case when p\.directory_email_opt_in then coalesce\(u\.email_display, u\.email\) end email/);
  assert.match(select, /null::text email/);
  assert.match(memberDirectorySource, /where sp\.directory_email_opt_in and coalesce\(su\.email_display, su\.email\) ilike/);
  assert.match(memberDirectorySource, /join users u on u\.id = p\.user_id and u\.deleted_at is null and u\.account_state in \('active', 'migrated_pending'\)/);
  assert.match(memberDirectorySource, /not exists \(select 1 from application_roles ar where ar\.user_id = u\.id and ar\.revoked_at is null and ar\.role in \('administrator', 'super_admin'\)\)/);
  assert.doesNotMatch(select, /address|postal_code|userId/i);
  // The internal profile id exists only to join the live check and is stripped from every returned row.
  assert.match(memberDirectorySource, /rows\.flatMap\(\(\{ profileId, \.\.\.row \}\)/);
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

test('the paid directory page offers bold, non-underlined gold-on-hover email links and no Contact column, without rendering a database identifier', () => {
  assert.doesNotMatch(memberPageSource, /row\.original\.(id|profileId|userId)\b/);
  assert.match(memberPageSource, /href=\{`mailto:\$\{row\.original\.email\}`\}/);
  assert.match(memberPageSource, /className="font-bold no-underline transition-colors hover:text-gold focus-visible:text-gold" href=\{`mailto:/);
  assert.doesNotMatch(memberPageSource, /id: 'actions'|CONTACT|Email member|(?<![-\w])underline(?![-\w])/);
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
  assert.match(memberRouteSource, />Map<\/Link>/);
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

test('directory defaults to the requested separate name, member detail and email columns, with no Contact column', () => {
  const columnBlock = memberPageSource.slice(memberPageSource.indexOf('id: \'firstName\''), memberPageSource.indexOf('], []),'));
  const ids = [...columnBlock.matchAll(/id: \'([^\']+)\'/g)].map((match) => match[1]);
  assert.deepEqual(ids, ['firstName', 'lastName', 'type', 'region', 'federation', 'email']);
  assert.match(memberPageSource, /columnOrder: \['firstName', 'lastName', 'type', 'region', 'federation', 'email'\]/);
  assert.match(columnBlock, /header: header\('Member Type'\)/);
  assert.doesNotMatch(columnBlock, /CONTACT/);
});

test('descending name sorting applies the same direction to last and first names', () => {
  assert.ok(memberDirectorySource.includes("...(id === 'name' || id === 'lastName' ? [sql`p.first_name ${direction} nulls last`] : [])"));
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

test('map dots sit at fixed country centers with area proportional to the member count', () => {
  const dots = buildMemberMapDots([
    { countryCode: 'US', memberCount: 100 },
    { countryCode: 'DE', memberCount: 25 },
    { countryCode: 'ZZ', memberCount: 9 },
  ], (code) => code);
  assert.deepEqual(dots.map((dot) => dot.countryCode), ['US', 'DE']);
  assert.equal(dots[0].radius, MAP_DOT_MAX_RADIUS);
  assert.ok(Math.abs(dots[1].radius - MAP_DOT_MAX_RADIUS / 2) < 0.1);
  assert.equal(dotRadius(1, 10000), MAP_DOT_MIN_RADIUS);
  assert.deepEqual(Object.keys(dots[0]).sort(), ['countryCode', 'countryName', 'lat', 'lng', 'memberCount', 'radius']);
});

test('the dot map is MapLibre with bundled brand-colored shapes and makes no external tile request', () => {
  const canvas = readFileSync('components/directory/member-map-canvas.tsx', 'utf8');
  assert.match(canvas, /import\('maplibre-gl'\)/);
  assert.match(canvas, /'\/geo\/world-countries\.geojson'/);
  assert.doesNotMatch(canvas, /https?:\/\//);
  assert.match(canvas, /OCEAN = '#050c20'/);
  assert.match(canvas, /GOLD = '#d3af37'/);
});

test('country centers sit inside plausible bounds for their country (regression: Ashmore/Cartier overwrote Australia)', () => {
  const [auLng, auLat] = COUNTRY_CENTROIDS.AU;
  assert.ok(auLng > 125 && auLng < 150 && auLat < -20 && auLat > -35);
  const [usLng, usLat] = COUNTRY_CENTROIDS.US;
  assert.ok(usLng < -90 && usLng > -110 && usLat > 35 && usLat < 45);
});

test('the map camera fits the world responsively instead of a fixed desktop-sized minimum zoom', () => {
  const canvas = readFileSync('components/directory/member-map-canvas.tsx', 'utf8');
  assert.match(canvas, /bounds: \[\[-170, -56\], \[180, 80\]\]/);
  assert.match(canvas, /minZoom: -1,/);
});

test('the public map excludes blank or malformed country codes so a bad legacy value cannot crash the page', () => {
  assert.match(aggregateSource, /where c\.country_code in \(\$\{sql\.join\(ISO_COUNTRY_CODES/);
  assert.match(readFileSync('lib/membership/countries.ts', 'utf8'), /try \{[\s\S]*englishRegionNames\.of[\s\S]*\} catch/);
});

test('the bundled MapLibre worker matches the installed maplibre-gl version and the canvas points at it', () => {
  const canvas = readFileSync('components/directory/member-map-canvas.tsx', 'utf8');
  assert.match(canvas, /setWorkerUrl\('\/maplibre\/maplibre-gl-worker\.mjs'\)/);
  assert.ok(
    readFileSync('public/maplibre/maplibre-gl-worker.mjs').equals(readFileSync('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')),
    'public/maplibre/maplibre-gl-worker.mjs must be re-copied from node_modules/maplibre-gl/dist after a maplibre-gl upgrade',
  );
});

test('the members map page shows no descriptive footnote text beneath the map', () => {
  assert.doesNotMatch(publicPageSource, /This infographic shows only/);
});

test('the map country is the National Federation country, falling back to the address country', () => {
  assert.match(aggregateSource, /min\(r\.national_federation_country_code\) from professional_roles r where r\.profile_id = p\.id/);
  assert.match(aggregateSource, /nullif\(p\.country_code, ''\)/);
  assert.match(aggregateSource, /group by c\.country_code/);
});

test('the signed-in members directory map tab is labelled just "Map"', () => {
  assert.match(publicPageSource, />Map<\/Link>/);
  assert.doesNotMatch(publicPageSource, /Map \/ Infographic/);
});

test('a failed directory load is logged with its cause, and rate limiting gets its own message instead of the generic failure', () => {
  assert.match(memberRouteSource, /if \(error instanceof DirectoryRateLimitedError\) rateLimited = true;/);
  assert.match(memberRouteSource, /Sentry\.captureException\(error, \{ tags: \{ area: 'members-directory', operation: 'list' \} \}\)/);
  assert.match(memberRouteSource, /console\.error\('\[members-directory\] listing failed'/);
  assert.match(memberRouteSource, /rateLimited \? <p/);
  assert.match(memberRouteSource, /Please wait a few minutes and try again\./);
});

const mapCanvasSource = readFileSync('components/directory/member-map-canvas.tsx', 'utf8');
const openDirectorySource = readFileSync('components/directory/open-directory-for-country.ts', 'utf8');
const dailyCacheSource = readFileSync('lib/cache/daily-cache.ts', 'utf8');

test('the map and the directory listing are cached for a day, but access control and rate limiting still run on every request', () => {
  assert.match(dailyCacheSource, /DAILY_REVALIDATE_SECONDS = 24 \* 60 \* 60/);
  assert.match(dailyCacheSource, /unstable_cache\(compute, keyParts, \{ revalidate: DAILY_REVALIDATE_SECONDS/);
  assert.match(aggregateSource, /dailyCache\(queryMemberConcentration, \['public-member-concentration'\]\)/);
  assert.match(memberDirectorySource, /dailyCache\(runDirectoryQuery, \['member-directory-query'\]\)/);
  // The authorization and rate-limit checks sit before the cached call, never inside it.
  const listing = memberDirectorySource.slice(memberDirectorySource.indexOf('export async function listMemberDirectory'));
  const cachedCall = listing.indexOf('(cacheable ? cachedDirectoryQuery : runDirectoryQuery)(query)');
  assert.ok(cachedCall > 0);
  assert.ok(listing.indexOf("requireAccountAccess('member')") < cachedCall);
  assert.ok(listing.indexOf("checkRateLimit('member_directory_search'") < cachedCall);
  // Privacy-sensitive data is never in the cached result: the email is read live per page, with the
  // same eligibility rule, and members no longer eligible are dropped from a cached page.
  const cachedQuery = memberDirectorySource.slice(memberDirectorySource.indexOf('async function runDirectoryQuery'), memberDirectorySource.indexOf('async function liveDirectoryDetails'));
  assert.match(cachedQuery, /null::text email/);
  assert.doesNotMatch(cachedQuery, /directory_email_opt_in/);
  const liveQuery = memberDirectorySource.slice(memberDirectorySource.indexOf('async function liveDirectoryDetails'), memberDirectorySource.indexOf('const cachedDirectoryQuery'));
  assert.match(liveQuery, /case when p\.directory_email_opt_in then coalesce\(u\.email_display, u\.email\) end email/);
  assert.match(liveQuery, /where \$\{eligibleCondition\} and p\.id in/);
  assert.match(listing, /live\.has\(profileId\) \?/);
  // A text search or email sort can match/order by an opted-out email, so it is never cached.
  assert.match(listing, /const cacheable = !filters\.q && !filters\.sort\.some\(\(\{ id \}\) => id === 'email'\);/);
  // A failed map query must not be cached for a day: the cached function throws, the wrapper catches.
  const cachedMap = aggregateSource.slice(aggregateSource.indexOf('async function queryMemberConcentration'), aggregateSource.indexOf('const cachedMemberConcentration'));
  assert.doesNotMatch(cachedMap, /catch/);
  assert.match(aggregateSource, /try \{\s*return \{ areas: await cachedMemberConcentration\(\)/);
});

test('clicking a country on the map opens the directory filtered to that federation, for signed-in members only', () => {
  assert.match(publicPageSource, /<ConcentrationMap areas=\{concentration\.areas\} canOpenDirectory=\{Boolean\(user\)\} \/>/);
  assert.match(concentrationMapSource, /canOpenDirectory = false/);
  // The Map tab is only the map: no picker, dropdown or other control under or beside it.
  assert.doesNotMatch(concentrationMapSource, /Picker|<select|<form|<button/);
  assert.ok(!existsSync('components/directory/country-directory-picker.tsx'));
  // The hover text is exactly the original, for every viewer: no added hint.
  assert.match(mapCanvasSource, /text\.textContent = `\$\{properties\.countryName\}: \$\{properties\.memberCount\} members`;/);
  assert.doesNotMatch(mapCanvasSource, /click to view/);
  // Click handler and pointer cursor exist only when the viewer is signed in.
  assert.match(mapCanvasSource, /if \(canOpenDirectory\) \{\s*map\.on\('click', 'member-dots'/);
  assert.match(mapCanvasSource, /if \(canOpenDirectory\) map\.getCanvas\(\)\.style\.cursor = 'pointer'/);
  assert.doesNotMatch(mapCanvasSource.replace(/if \(canOpenDirectory\) map\.getCanvas\(\)\.style\.cursor = 'pointer';/, ''), /style\.cursor = 'pointer'/);
  // The filter is saved as the member's view (never put in the URL), then the tab opens.
  assert.match(openDirectorySource, /\/api\/directory\/view/);
  assert.match(openDirectorySource, /federation: countryCode/);
  assert.match(openDirectorySource, /navigate\('\/about\/members-directory\?tab=directory'\)/);
  assert.doesNotMatch(openDirectorySource, /federation=/);
});

test('every seminar row (homepage and seminars page) hovers like the homepage news cards and uses the compact homepage column', () => {
  const registrations = readFileSync('components/seminars/member-registrations.tsx', 'utf8');
  const home = readFileSync('app/(marketing)/page.tsx', 'utf8');
  const globals = readFileSync('app/globals.css', 'utf8');
  // Same effect as `card-midnight` on the news cards: gold border at 45% and a 2px lift over 0.3s.
  assert.match(globals, /@utility card-midnight \{[^}]*border-color 0\.3s ease,\s*transform 0\.3s ease;\s*&:hover \{\s*border-color: rgb\(211 175 55 \/ 45%\);\s*transform: translateY\(-2px\);/);
  assert.match(registrations, /SEMINAR_ROW_CLASS = 'outline outline-1 outline-transparent transition-\[outline-color,translate\] duration-300 ease-out has-\[article:hover\]:-translate-y-0\.5 has-\[article:hover\]:outline-gold\/45 has-\[a:focus-visible\]:outline-gold\/45'/);
  assert.doesNotMatch(registrations, /bg-surface-raised\/35/);
  // The row's whole <li> (rule to rule) takes the effect, on the homepage and in all four seminars listings.
  assert.equal((registrations.match(/<li className=\{SEMINAR_ROW_CLASS\} key=\{seminar\.id\}>/g) ?? []).length, 4);
  assert.equal((home.match(/<li className=\{SEMINAR_ROW_CLASS\} key=\{seminar\.id\}>/g) ?? []).length, 2);
  // The card fills its row (so the clickable overlay covers the full width) and no list is stretched past the homepage's column.
  assert.match(registrations, /<article className="relative grid max-w-full gap-5 px-4 py-6/);
  assert.match(registrations, /SEMINAR_LIST_CLASS = '-mx-4 w-\[calc\(100%\+2rem\)\] max-w-\[37rem\] divide-y/);
  assert.doesNotMatch(registrations, /w-fit max-w-full divide-y/);
  // The list overhangs 1rem, so the cancel control under a My Seminars row gets the same 1rem padding as the card.
  assert.match(registrations, /<div className="px-4 pb-6"><SeminarForm action=\{cancelSeminarRegistrationAction\}/);
});

test('every sort row keeps the column, direction, remove and drag controls on one line, down to phone width', () => {
  const sortList = readFileSync('components/data-table/data-table-sort-list.tsx', 'utf8');
  const row = sortList.slice(sortList.indexOf('role="listitem"'));
  assert.match(row, /className="flex flex-nowrap items-center gap-2 rounded-md/);
  assert.doesNotMatch(row, /flex-wrap/);
  // The column picker takes the remaining width (and truncates) instead of a fixed 13rem that pushed the last icon down.
  assert.match(row, /className="min-w-0 flex-1 justify-between rounded font-normal"/);
  assert.doesNotMatch(row, /w-52/);
  assert.match(row, /className="w-24 shrink-0 rounded"/);
});

const migrationSource = readFileSync('lib/db/migrations/0081_member_directory_trigram_search.sql', 'utf8');
const schemaSource = readFileSync('lib/db/schema.ts', 'utf8');

test('directory text search is made of one indexable arm per field, and each arm has a matching trigram index', () => {
  // An `or` across profiles and users cannot use any index, so every searched expression is its own union arm.
  assert.match(memberDirectorySource, /select id from profiles where first_name ilike/);
  assert.match(memberDirectorySource, /union select id from profiles where last_name ilike/);
  assert.match(memberDirectorySource, /union select id from profiles where \(first_name \|\| ' ' \|\| last_name\) ilike/);
  assert.doesNotMatch(memberDirectorySource, /concat_ws/);
  for (const index of ['profiles_first_name_trgm_idx', 'profiles_last_name_trgm_idx', 'profiles_full_name_trgm_idx', 'users_display_email_trgm_idx']) {
    assert.ok(schemaSource.includes(index), `${index} must be declared in the schema`);
    assert.ok(migrationSource.includes(index), `${index} must be created by migration 0081`);
  }
  // The migration reuses the installed extension wherever it lives, and skips (not fails) when it is unavailable.
  assert.match(migrationSource, /from pg_extension/i);
  assert.match(migrationSource, /%I\.gin_trgm_ops/);
  assert.match(migrationSource, /RAISE NOTICE 'pg_trgm is unavailable/);
  assert.doesNotMatch(migrationSource, /\bDROP\b|\bALTER\b|\bDELETE\b/i);
});

test('only cache misses and uncached searches take a slot in the query gate; cache hits and authorization never wait', () => {
  const listing = memberDirectorySource.slice(memberDirectorySource.indexOf('export async function listMemberDirectory'));
  assert.ok(listing.indexOf('directoryQueryGate') === -1, 'listMemberDirectory must not hold a slot around cached reads');
  const compute = memberDirectorySource.slice(memberDirectorySource.indexOf('async function runDirectoryQuery'), memberDirectorySource.indexOf('async function liveDirectoryDetails'));
  assert.match(compute, /directoryQueryGate\.run\(/);
  assert.match(publicPageSource, /else if \(error instanceof DirectoryBusyError\) busy = true;/);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('the query gate runs at most N operations at once, queues the next in order, and frees the slot on failure', async () => {
  const gate = createQueryGate(2, 5, 1_000);
  const order: string[] = [];
  const first = deferred();
  const second = deferred();
  const a = gate.run(async () => { order.push('a'); await first.promise; return 'a'; });
  const b = gate.run(async () => { order.push('b'); await second.promise; return 'b'; });
  const c = gate.run(async () => { order.push('c'); return 'c'; });
  const d = gate.run(async () => { order.push('d'); throw new Error('boom'); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['a', 'b']);
  assert.deepEqual(gate.snapshot(), { queued: 2, running: 2 });
  first.resolve();
  assert.equal(await a, 'a');
  assert.equal(await c, 'c');
  await assert.rejects(d, /boom/);
  second.resolve();
  assert.equal(await b, 'b');
  assert.deepEqual(order, ['a', 'b', 'c', 'd']);
  assert.deepEqual(gate.snapshot(), { queued: 0, running: 0 }, 'a failed operation must still release its slot');
});

test('the query gate sheds load with DirectoryBusyError when the queue is full or the wait runs out', async () => {
  const full = createQueryGate(1, 1, 1_000);
  const hold = deferred();
  const running = full.run(() => hold.promise);
  const queued = full.run(async () => 'queued');
  await assert.rejects(full.run(async () => 'overflow'), DirectoryBusyError);
  hold.resolve();
  await running;
  assert.equal(await queued, 'queued');

  const slow = createQueryGate(1, 5, 20);
  const stuck = deferred();
  const occupying = slow.run(() => stuck.promise);
  await assert.rejects(slow.run(async () => 'late'), DirectoryBusyError);
  assert.deepEqual(slow.snapshot(), { queued: 0, running: 1 }, 'a timed-out waiter must leave the queue');
  stuck.resolve();
  await occupying;
  assert.deepEqual(slow.snapshot(), { queued: 0, running: 0 });
});

test('the map shows a one-time, short-lived, animated click hint over the US bubble, for signed-in members only', () => {
  const hint = readFileSync('components/directory/map-first-visit-hint.tsx', 'utf8');
  const canvas = readFileSync('components/directory/member-map-canvas.tsx', 'utf8');
  const globals = readFileSync('app/globals.css', 'utf8');
  // Approved copy, with icons rather than a wall of text, in the menu dropdown's bubble style.
  assert.match(hint, /<span>Click a bubble to see its members<\/span>/);
  assert.match(hint, /MousePointerClick/);
  assert.match(hint, /Users/);
  assert.match(hint, /rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md/);
  // It never blocks the map underneath.
  assert.match(hint, /pointer-events-none/);
  // First time only (remembered per browser), and short-lived.
  assert.match(hint, /MAP_HINT_STORAGE_KEY = 'idoc-map-click-hint-v1'/);
  assert.match(hint, /MAP_HINT_VISIBLE_MS = 7000/);
  assert.match(canvas, /if \(us && !mapHintAlreadySeen\(\)\)/);
  assert.match(canvas, /markMapHintSeen\(\);/);
  // Only signed-in members (the only ones a click works for) and only when there is a US bubble to point at.
  assert.match(canvas, /const us = canOpenDirectory \? dots\.find\(\(dot\) => dot\.countryCode === 'US'\) : undefined;/);
  // Touching the map dismisses it at once.
  assert.match(canvas, /map\.on\('mousedown', dismiss\)/);
  // It animates to grab attention (flash + bounce + tap + ring), only for visitors who allow motion.
  assert.match(globals, /@media \(prefers-reduced-motion: no-preference\) \{[^@]*idoc-map-hint-flash[^@]*idoc-map-hint-bob[^@]*idoc-map-hint-tap[^@]*idoc-map-hint-ring/);
});

test('the homepage shows a static map preview whose whole tile links to the interactive map with a sliding blue overlay', () => {
  const preview = readFileSync('components/directory/member-map-preview.tsx', 'utf8');
  const canvas = readFileSync('components/directory/member-map-canvas.tsx', 'utf8');
  const home = readFileSync('app/(marketing)/page.tsx', 'utf8');
  assert.match(preview, /href="\/about\/members-directory"/);
  assert.match(preview, /translate-y-full[^"]*bg-blue-600\/70|bg-blue-600\/70[^"]*translate-y-full/);
  assert.match(preview, /group-hover:translate-y-0/);
  assert.match(preview, /View Interactive Map/);
  assert.match(preview, /ArrowUpRight/);
  assert.match(canvas, /interactive: !preview/);
  assert.match(home, /<MemberMapPreview areas=\{concentration\.areas\}/);
});
