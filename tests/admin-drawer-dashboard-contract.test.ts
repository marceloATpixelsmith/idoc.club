import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const newsPage = readFileSync('app/(dashboard)/admin/news/page.tsx', 'utf8');
const newsDrawer = readFileSync('app/(dashboard)/admin/news/news-drawer.tsx', 'utf8');
const resourceTable = readFileSync('components/admin/resource-data-table.tsx', 'utf8');
const supportPage = readFileSync('app/(dashboard)/admin/support/page.tsx', 'utf8');
const supportDrawer = readFileSync('app/(dashboard)/admin/support/support-detail-drawer.tsx', 'utf8');
const supportTable = readFileSync('app/(dashboard)/admin/support/support-inbox-table.tsx', 'utf8');
const seminarPage = readFileSync('app/(dashboard)/admin/seminars/page.tsx', 'utf8');
const seminarDrawer = readFileSync('app/(dashboard)/admin/seminars/seminar-drawer.tsx', 'utf8');
const bulkActions = readFileSync('app/(dashboard)/admin/bulk-actions.ts', 'utf8');
const dashboard = readFileSync('app/(dashboard)/admin/page.tsx', 'utf8');
const exportsPage = readFileSync('app/(dashboard)/admin/exports/page.tsx', 'utf8');
const pageHeader = readFileSync('components/site/PageHeader.tsx', 'utf8');
const sharedButton = readFileSync('components/ui/button.tsx', 'utf8');
const globals = readFileSync('app/globals.css', 'utf8');
const siteHeader = readFileSync('components/site/Header.tsx', 'utf8');
const runbook = readFileSync('docs/07-administrator-and-operations-runbook.md', 'utf8');
const requirements = readFileSync('docs/08-product-roadmap-and-functional-requirements.md', 'utf8');

test('News and Support edit actions use table-backed admin drawers', () => {
  assert.match(newsPage, /AdminNewsDrawer/);
  assert.match(newsDrawer, /AdminFormDrawer/);
  assert.match(newsDrawer, /AdminFormSection/);
  assert.doesNotMatch(newsDrawer, /Quick actions|Quick links|Reschedule/);
  assert.match(resourceTable, /\/admin\/news\?articleId=/);

  assert.match(supportPage, /SupportDetailDrawer/);
  assert.match(supportDrawer, /AdminFormDrawer/);
  assert.match(supportDrawer, /AdminFormSection/);
  assert.match(supportDrawer, /name="closed"/);
  assert.match(supportTable, /\/admin\/support\?supportId=/);
});

test('selection bars expose Support close and News status bulk actions', () => {
  assert.match(resourceTable, /BulkNewsStatusSelected/);
  assert.match(supportTable, /BulkCloseSupportSelected/);
  assert.match(bulkActions, /export async function bulkCloseSupportRows/);
  assert.match(bulkActions, /export async function bulkSetNewsStatus/);
  assert.match(bulkActions, /admin\.news_article\.bulk_status_changed/);
});

test('admin dashboard surfaces assigned support, reconciliation, and revenue', () => {
  assert.match(dashboard, /My unresolved support/);
  assert.match(dashboard, /Stripe reconciliation/);
  assert.match(dashboard, /Revenue overview/);
  assert.match(dashboard, /Gross revenue/);
  assert.match(dashboard, /Stripe/);
  assert.match(dashboard, /Manual/);
  assert.match(dashboard, /Payments/);
});

test('exports are bullets with icon-only download controls', () => {
  assert.match(exportsPage, /list-disc/);
  assert.match(exportsPage, /Download/);
  assert.doesNotMatch(exportsPage, /\(CSV\)|underline underline-offset/);
});

test('page-header actions align to the right on larger screens', () => {
  assert.match(pageHeader, /md:flex-row/);
  assert.match(pageHeader, /md:justify-between/);
  assert.match(pageHeader, /shrink-0 md:pl-8/);
});

test('admin drawer UX contract is permanent documentation', () => {
  for (const source of [runbook, requirements]) {
    assert.match(source, /drawer/i);
    assert.match(source, /successful/i);
    assert.match(source, /refresh/i);
    assert.match(source, /Quick Links|Quick Actions/i);
    assert.match(source, /Support/);
    assert.match(source, /News\/Blog/);
  }
});


test('Seminar edit and create stay over the table and table actions own navigation/download shortcuts', () => {
  assert.match(seminarPage, /AdminSeminarDrawer/);
  assert.match(seminarPage, /seminarId/);
  assert.match(seminarPage, /new/);
  assert.match(seminarDrawer, /AdminFormDrawer/);
  assert.doesNotMatch(seminarDrawer, /Quick links|Quick actions|Download registrations|View registrations/i);
  assert.match(resourceTable, /\/admin\/seminars\?seminarId=/);
  assert.match(resourceTable, /seminars\/registrations\?seminarId=/);
  assert.match(resourceTable, /Download this seminar's registrations/);
});


test('ordinary gold and blue buttons share the canonical Member Login pill radius', () => {
  assert.match(siteHeader, /MemberLoginLink[\s\S]*rounded-full/);
  assert.match(sharedButton, /rounded-full text-sm/);
  assert.match(globals, /Canonical button radius/);
  assert.match(globals, /\.idoc-secondary-button[\s\S]*border-radius: 9999px/);
  assert.match(globals, /\[data-idoc-table-control\][\s\S]*border-radius: 9999px/);
});
