import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the saved directory cookie is untrusted and always re-validated through the shared normalizer', () => {
  const view = readFileSync(new URL('../lib/directory/member-directory-view.ts', import.meta.url), 'utf8');
  assert.match(view, /import \{ normalizeDirectoryFilters/);
  assert.match(view, /catch \{\s*return \{\};/);
  assert.match(view, /httpOnly: true/);
  assert.match(view, /sameSite: 'lax'/);
  const route = readFileSync(new URL('../app/api/directory/view/route.ts', import.meta.url), 'utf8');
  assert.match(route, /requireCsrfTokenValue/);
  assert.match(route, /requireAccountAccess\('member'\)/);
  assert.match(route, /serializeDirectoryView\(await request\.json\(\), actor\.id\)/);
  assert.match(view, /owner === userId/);
});

test('the directory never reads or writes search, filters, sort or page through the URL', () => {
  const page = readFileSync(new URL('../app/(marketing)/about/members-directory/page.tsx', import.meta.url), 'utf8');
  const table = readFileSync(new URL('../components/directory/member-directory-table.tsx', import.meta.url), 'utf8');
  assert.match(page, /parseDirectoryView\(\(await cookies\(\)\)\.get\(DIRECTORY_VIEW_COOKIE\)\?\.value, user\.id\)/);
  assert.doesNotMatch(page, /listMemberDirectory\(params\)/);
  assert.match(table, /\/api\/directory\/view/);
  assert.match(table, /saveQueue\.current = saveQueue\.current\.then/);
  assert.match(table, /if \(!response\.ok\) throw/);
  assert.match(table, /if \(body === lastRequestedView\.current\) return;/);
  assert.doesNotMatch(table, /URLSearchParams|router\.replace|usePathname/);
});
