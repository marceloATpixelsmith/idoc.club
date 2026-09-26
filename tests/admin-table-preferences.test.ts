import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const preferences = readFileSync(new URL('../lib/admin/table-preferences.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../lib/db/migrations/0045_administrator_table_preferences.sql', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/admin/table-preferences/[table]/route.ts', import.meta.url), 'utf8');
const membershipPage = readFileSync(new URL('../app/(dashboard)/admin/members/page.tsx', import.meta.url), 'utf8');
const memberTable = readFileSync(new URL('../app/(dashboard)/admin/members/members-table.tsx', import.meta.url), 'utf8');
const resourceTable = readFileSync(new URL('../components/admin/resource-data-table.tsx', import.meta.url), 'utf8');
const supportTable = readFileSync(new URL('../app/(dashboard)/admin/support/support-inbox-table.tsx', import.meta.url), 'utf8');

test('administrator table preferences are owner-scoped and uniquely upserted by table', () => {
  assert.match(migration, /UNIQUE INDEX "administrator_table_preferences_user_table_unique"/);
  assert.match(migration, /\("user_id","table_identifier"\)/);
  assert.match(preferences, /eq\(administratorTablePreferences\.userId, actor\.id\)/);
  assert.match(preferences, /onConflictDoUpdate/);
  assert.doesNotMatch(route, /userId/);
});

test('only validated durable state is accepted for each supported table', () => {
  for (const table of ['memberships', 'support', 'news', 'seminars', 'content_pages']) assert.match(preferences, new RegExp(`${table}: z\\.object`));
  for (const transient of ['selected', 'loading', 'openMenu', 'confirmation', 'bulkAction']) assert.doesNotMatch(preferences, new RegExp(`${transient}:`));
  assert.match(preferences, /\.strict\(\)/);
  assert.match(preferences, /z\.union\(\[z\.literal\(10\), z\.literal\(25\), z\.literal\(50\), z\.literal\(100\)\]\)/);
});

test('database preferences are always the source of truth for filters/sort/columns/pagination -- there is no URL state to take precedence over, and only profileId is read from the URL', () => {
  assert.match(membershipPage, /searchParams: Promise<\{ profileId\?: string \}>/);
  assert.match(membershipPage, /const savedPreferences = await getTablePreferences\('memberships'\);/);
  assert.doesNotMatch(membershipPage, /hasUrlState/);
  assert.doesNotMatch(membershipPage, /redirect\(/);
  assert.match(route, /requireCsrfTokenValue/);
  assert.match(route, /resetTablePreferences/);
});

test('a multi-select facet filter\'s selected values are read from react-table\'s own columnFilters state (an array) and comma-joined into a single preference field when persisted -- there is no URL-repeated-key form to canonicalize anymore', () => {
  for (const table of [memberTable, resourceTable, supportTable]) {
    assert.match(table, /function filterToken\(columnFilters: ColumnFiltersState, id: string\): string \| undefined \{/);
    assert.match(table, /const value = columnFilters\.find\(\(filter\) => filter\.id === id\)\?\.value;/);
  }
  for (const field of ['country', 'federation', 'region', 'status', 'type']) assert.match(memberTable, new RegExp(`${field}: filterToken\\(state\\.columnFilters, '${field}'\\)`));
  assert.match(resourceTable, /status: filterToken\(state\.columnFilters, 'status'\)/);
  assert.match(resourceTable, /preferences\.audience = filterToken\(state\.columnFilters, 'audience'\)/);
  for (const field of ['assigned', 'category', 'status']) assert.match(supportTable, new RegExp(`${field}: filterToken\\(state\\.columnFilters, '${field}'\\)`));
});
