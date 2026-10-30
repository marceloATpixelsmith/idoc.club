import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const drawer = readFileSync('components/admin/admin-form-drawer.tsx', 'utf8');
const table = readFileSync('components/data-table/data-table.tsx', 'utf8');
const newsPage = readFileSync('app/(dashboard)/admin/news/page.tsx', 'utf8');
const newsForm = readFileSync('components/news/news-form.tsx', 'utf8');
const seminarForm = readFileSync('components/seminars/seminar-form.tsx', 'utf8');
const supportForm = readFileSync('components/support/support-form.tsx', 'utf8');

test('shared admin drawer closes via a single canonical replacement after a successful save', () => {
  assert.match(drawer, /window\.dispatchEvent\(new Event\('idoc:table-refresh-start'\)\)/);
  assert.match(drawer, /router\.replace\(closeHref\)/);
  assert.doesNotMatch(drawer, /router\.push\(closeHref\);\s*router\.refresh\(\)/);
  for (const form of [newsForm, seminarForm, supportForm]) {
    assert.match(form, /state\.success && closeDrawer/);
  }
});

test('shared data table displays loading skeleton while a saved drawer refreshes its rows', () => {
  assert.match(table, /addEventListener\('idoc:table-refresh-start', begin\)/);
  assert.match(table, /setDrawerRefreshPending\(true\)/);
  assert.match(table, /setDrawerRefreshPending\(false\)/);
  assert.match(table, /loading \|\| mutationPending \|\| refreshPending \|\| drawerRefreshPending/);
  assert.match(table, /<Skeleton className="h-5 w-full" \/>/);
});

test('news drawer remounts when another article is selected', () => {
  assert.match(newsPage, /<AdminNewsDrawer key=\{params\.articleId\} articleId=\{params\.articleId\}/);
});

test('every admin drawer closes back to the bare table URL and remounts per record', () => {
  assert.doesNotMatch(drawer, /router\.push\(closeHref\)/);
  assert.match(drawer, /export function useAdminDrawerClose/);
  assert.match(drawer, /idoc:table-refresh-end/);
  assert.match(table, /addEventListener\('idoc:table-refresh-end', end\)/);
  const members = readFileSync('app/(dashboard)/admin/members/member-detail-sheet.tsx', 'utf8');
  assert.match(members, /useAdminDrawerClose\(closeHref\)/);
  assert.doesNotMatch(members, /router\.push\(closeHref\)/);
  assert.match(members, /startPaymentRefresh\(\(\) => router\.refresh\(\)\)/);
  const mounts: Array<[string, RegExp]> = [
    ['app/(dashboard)/admin/seminars/registrations/page.tsx', /<RegistrationCreateDrawer key="new"[\s\S]*<RegistrationDetailSheet key=\{selected\.id\}/],
    ['app/(dashboard)/admin/seminars/page.tsx', /<AdminSeminarDrawer key="new" isNew \/>[\s\S]*<AdminSeminarDrawer key=\{seminarId\}/],
    ['app/(dashboard)/admin/support/page.tsx', /<SupportDetailDrawer key=\{supportId\}/],
  ];
  for (const [path, pattern] of mounts) assert.match(readFileSync(path, 'utf8'), pattern, path);
  assert.match(readFileSync('app/(dashboard)/admin/seminars/actions.ts', 'utf8'), /'Seminar\/course saved\.', '\/admin\/seminars'\)/);
});
