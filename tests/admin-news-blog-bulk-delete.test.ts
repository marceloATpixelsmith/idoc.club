import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const resourceTable = readFileSync('components/admin/resource-data-table.tsx', 'utf8');
const resourceList = readFileSync('components/admin/resource-list-page.tsx', 'utf8');
const members = readFileSync('app/(dashboard)/admin/members/members-table.tsx', 'utf8');
const registrations = readFileSync('app/(dashboard)/admin/seminars/registrations/registrations-table.tsx', 'utf8');
const support = readFileSync('app/(dashboard)/admin/support/support-inbox-table.tsx', 'utf8');
const bulk = readFileSync('app/(dashboard)/admin/bulk-actions.ts', 'utf8');
const memberLifecycle = readFileSync('lib/admin/member-lifecycle.ts', 'utf8');
const news = readFileSync('lib/news/articles.ts', 'utf8');
const migration = readFileSync('lib/db/migrations/0064_news_article_type.sql', 'utf8');
const globals = readFileSync('app/globals.css', 'utf8');
const home = readFileSync('app/(marketing)/page.tsx', 'utf8');
const newsPage = readFileSync('app/(marketing)/news/page.tsx', 'utf8');
const blogPage = readFileSync('app/(marketing)/blog/page.tsx', 'utf8');

test('News Blog admin table exposes slug, typed/status icon labels, filter and dd/mm/yyyy date', () => {
  assert.match(resourceTable, /row\.original\.slug/);
  assert.match(resourceTable, /BookOpenText/);
  assert.match(resourceTable, /Newspaper/);
  assert.match(resourceTable, /InlineStatusEditor/);
  assert.match(resourceTable, /font-medium leading-8 uppercase/);
  assert.match(resourceTable, /row\.original\.type[\s\S]*?toUpperCase\(\)/);
  assert.match(resourceTable, /types: \[\{ label: 'NEWS', value: 'news' \}, \{ label: 'BLOG', value: 'blog' \}\]/);
  assert.match(resourceList, /publication: formatAdminDate/);
  assert.match(resourceTable, /publication: \{ width: '180px' \}/);
  assert.match(resourceTable, /updated: \{ width: '190px' \}/);
  assert.match(resourceTable, /id === 'publication' \|\| id === 'updated'/);
  assert.match(resourceTable, /justify-between whitespace-nowrap/);
  assert.doesNotMatch(resourceTable, /ChevronDown|top-1\/2 size-3\.5 -translate-y-1\/2/);
});

test('News Blog type and thumbnail are persisted and public listing queries are type-filtered', () => {
  assert.match(migration, /article_type varchar\(10\) not null default 'news'/);
  assert.match(migration, /thumbnail_url text/);
  assert.match(news, /NEWS_TYPES = \['news', 'blog'\]/);
  assert.match(news, /article_type=\$\{articleType\}/);
  assert.match(newsPage, /listAllPublicArticles\('news'\)/);
  assert.match(blogPage, /listPublicArticles\(pageParam, 'blog'\)/);
  assert.match(home, /listPublicArticles\('1', 'news'\)/);
  assert.match(home, /listPublicArticles\('1', 'blog'\)/);
});

test('legacy article images are backfilled to durable IDOC Cloudinary copies', () => {
  for (const id of [
    'jacques-van-daele',
    'stephen-clarke',
    'fei-judging-guidelines',
    'fei-rules-revision',
    'modern-dressage-judging',
    'stress-in-dressage-horses',
    'integrity-beyond-compliance',
  ]) assert.match(migration, new RegExp('res\\.cloudinary\\.com/z6xv27qx/image/upload/v\\d+/' + id));
  assert.doesNotMatch(migration, /thumbnail_url = 'https:\/\/idoc\.club\/wp-content/);
});

test('Pages administration is fully retired while public CMS delivery remains separate', () => {
  for (const path of [
    'app/(dashboard)/admin/pages/page.tsx',
    'app/(dashboard)/admin/pages/new/page.tsx',
    'app/(dashboard)/admin/pages/[id]/page.tsx',
    'app/(dashboard)/admin/pages/actions.ts',
    'components/content/content-form.tsx',
  ]) assert.equal(existsSync(path), false, path);
  assert.doesNotMatch(resourceTable, /content_pages|\/admin\/pages/);
  assert.doesNotMatch(resourceList, /content_pages|\/admin\/pages/);
});

test('all five mutable record tables expose protected selected-row deletion', () => {
  assert.match(resourceTable, /table=\{tableType\}/);
  assert.match(members, /table="members"/);
  assert.match(registrations, /table="registrations"/);
  assert.match(support, /table="support"/);
  assert.match(bulk, /requireCsrfToken/);
  assert.match(bulk, /requireFreshStepUp/);
  assert.match(memberLifecycle, /Administrator accounts cannot be bulk deleted/);
  assert.match(bulk, /must be Draft or Canceled and have no registration history/);
  assert.match(bulk, /Registrations can only be deleted after cancellation/);
  assert.match(bulk, /Support conversations must be closed before they can be deleted/);
});

test('registration payment status and method are both icon-backed and status is uppercase', () => {
  assert.match(registrations, /PaymentStatusIcon status=\{row\.original\.payment_status\}/);
  assert.match(registrations, /PaymentMethodIcon method=\{row\.original\.payment_method_canonical_id\}/);
  assert.match(registrations, /registrationDisplayLabel[\s\S]*?\.toUpperCase\(\)/);
});

test('admin route icons are consistently brand gold including portalled controls', () => {
  assert.match(globals, /body:has\(\[data-idoc-admin-root\]\) svg[\s\S]*?color: var\(--gold\)/);
});


test('bulk Support close and News status updates keep server authorization, CSRF and audit evidence', () => {
  assert.match(bulk, /export async function bulkCloseSupportRows/);
  assert.match(bulk, /export async function bulkSetNewsStatus/);
  assert.match(bulk, /await requireCsrfToken/);
  assert.match(bulk, /requireAccountAccess\('administration'\)/);
  assert.match(bulk, /requireAdministrator\(actor\)/);
  assert.match(bulk, /support\.conversation\.closed/);
  assert.match(bulk, /admin\.news_article\.bulk_status_changed/);
  assert.match(bulk, /export async function updateAdminTableInlineField/);
  assert.match(bulk, /admin\.news_article\.inline_status_changed/);
  assert.match(bulk, /admin\.news_article\.inline_access_changed/);
  assert.match(bulk, /admin\.seminar\.inline_status_changed/);
  assert.match(bulk, /Every selected item needs a future publication date before it can be scheduled/);
});

test('inline News and Seminar statuses and News access show saving state until refreshed values arrive', () => {
  assert.match(resourceTable, /function InlineStatusEditor[\s\S]*?const saving = pending \|\| savingTarget !== null/);
  assert.match(resourceTable, /status === savingTarget\) setSavingTarget\(null\)/);
  assert.match(resourceTable, /aria-label="Updating status"[\s\S]*?animate-spin/);
  assert.match(resourceTable, /disabled=\{saving\}[\s\S]*?changeStatus/);
  assert.match(resourceTable, /function InlineAccessEditor[\s\S]*?const saving = pending \|\| savingTarget !== null/);
  assert.match(resourceTable, /savingTarget\.every\(\(item\) => actualAccess\.includes\(item\)\)/);
  assert.match(resourceTable, /aria-label="Updating access"[\s\S]*?animate-spin/);
  assert.match(resourceTable, /if \(tableType === 'seminars'\)/);
  assert.doesNotMatch(resourceTable, /ChevronDown/);
});


test('inline status selects do not inherit the global native select chevron', () => {
  const stylesheet = readFileSync('app/globals.css', 'utf8');
  assert.match(resourceTable, /idoc-inline-status-select/);
  assert.match(stylesheet, /select\.idoc-inline-status-select\s*\{\s*background-image:\s*none;\s*padding-right:\s*0;/);
});
