import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const preferences = readFileSync(new URL('../lib/admin/table-preferences.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../lib/db/migrations/0045_administrator_table_preferences.sql', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/admin/table-preferences/[table]/route.ts', import.meta.url), 'utf8');
const membershipPage = readFileSync(new URL('../app/(dashboard)/admin/members/page.tsx', import.meta.url), 'utf8');
const preferenceSync = readFileSync(new URL('../components/admin/table-preference-sync.tsx', import.meta.url), 'utf8');
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

test('URL state takes precedence and default Active applies only without URL or saved state', () => {
  assert.match(membershipPage, /hasUrlState \? null : await getTablePreferences\('memberships'\)/);
  assert.match(membershipPage, /defaultActive=\{!hasUrlState && !savedPreferences\}/);
  assert.match(route, /requireCsrfTokenValue/);
  assert.match(route, /resetTablePreferences/);
});

test('a multi-select facet filter value is canonicalized to its comma-joined form before being persisted, whether the URL wrote it as a repeated key or the toolbar\'s own comma-joined param', () => {
  assert.match(preferenceSync, /export function manyParam\(params: URLSearchParams, key: string\): string \| undefined \{/);
  assert.match(preferenceSync, /params\.getAll\(key\)/);
  for (const field of ['country', 'federation', 'region', 'status', 'type']) assert.match(memberTable, new RegExp(`${field}: manyParam\\(params, '${field}'\\)`));
  assert.match(resourceTable, /status: manyParam\(params, 'status'\)/);
  assert.match(resourceTable, /preferences\.audience = manyParam\(params, 'audience'\)/);
  for (const field of ['assigned', 'category', 'status']) assert.match(supportTable, new RegExp(`${field}: manyParam\\(params, '${field}'\\)`));
});
