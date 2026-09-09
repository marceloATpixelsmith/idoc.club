import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('lib/support/inbox.ts', 'utf8');
const migration = readFileSync('lib/db/migrations/0039_support_inbox.sql', 'utf8');
const memberThread = readFileSync('app/(dashboard)/dashboard/support/[publicId]/page.tsx', 'utf8');

test('support categories, states, body lengths, and opaque identifiers are constrained in both layers', () => {
  for (const value of ['billing_membership', 'seminars', 'technical_support', 'admin_responded', 'member_replied', 'closed']) {
    assert.match(source, new RegExp(value)); assert.match(migration, new RegExp(value));
  }
  assert.match(migration, /char_length\("body"\) between 1 and 10000/);
  assert.match(migration, /char_length\("subject"\) between 1 and 160/);
  assert.match(migration, /"public_id" uuid DEFAULT gen_random_uuid/);
  assert.match(migration, /support_messages_immutable.*BEFORE UPDATE OR DELETE/);
});

test('member-facing support labels match the approved categories and workflow statuses', () => {
  for (const label of ['Billing/Membership', 'Seminars', 'Technical Support', 'Open', 'Responded to by admin', 'Member Replied', 'Closed/Resolved']) {
    assert.match(source, new RegExp(label.replace('/', '\\/')));
  }
});

test('member boundaries derive ownership and never accept a submitted member identity', () => {
  assert.match(source, /member_user_id=\$\{actor\.id\}/);
  assert.doesNotMatch(source, /input\.member|memberUserId:/);
  assert.match(source, /requireAccountAccess\('member'\)/);
  assert.match(source, /isAdministrator\(actor\)/);
});

test('administrator mutations authorize roles and revalidate submitted assignees', () => {
  assert.match(source, /requireAccountAccess\('administration'\)/);
  assert.match(source, /requireAdministrator\(actor\)/);
  assert.match(source, /values\.map\(resolveEligibleAdministrator\)/);
  assert.match(source, /u\.account_state='active'/);
  assert.match(source, /requireSuperAdmin\(actor\)/);
});

test('thread transitions, read sides, chronological order, and idempotency are explicit', () => {
  assert.match(source, /status='admin_responded'/);
  assert.match(source, /status='member_replied'/);
  assert.match(source, /status === 'closed'/);
  assert.match(source, /author_side === 'admin' \? 'admin_responded'/);
  assert.match(source, /member_read_at=now\(\)/);
  assert.match(source, /admin_read_at=now\(\)/);
  assert.match(source, /order by m\.created_at,m\.id/);
  assert.match(source, /on conflict \(author_user_id,idempotency_key\) do nothing/);
});

test('message presentation uses escaped React text with whitespace preservation', () => {
  assert.match(memberThread, /whitespace-pre-wrap/);
  assert.match(memberThread, /String\(message\.body\)/);
  assert.doesNotMatch(memberThread, /dangerouslySetInnerHTML/);
});

test('administrator assignment and unread state use per-administrator records', () => {
  assert.match(source, /support_conversation_administrators/);
  assert.match(source, /support_administrator_read_cursors/);
  assert.match(source, /administrator_user_id=\$\{actor\.id\}/);
  assert.match(source, /on conflict\(conversation_id,administrator_user_id\) do update/);
});

test('the administrator queue provides Tablecn-style server controls', () => {
  const page = readFileSync('app/(dashboard)/admin/support/page.tsx', 'utf8');
  const table = readFileSync('app/(dashboard)/admin/support/support-inbox-table.tsx', 'utf8');
  const dataTable = readFileSync('components/data-table/data-table.tsx', 'utf8');
  const toolbar = readFileSync('components/data-table/data-table-advanced-toolbar.tsx', 'utf8');
  for (const control of ['DataTable', 'DataTableAdvancedToolbar', 'DataTableFilterList', 'DataTableFilterMenu', 'DataTableSortList', 'useDataTable', 'ActionBar']) assert.match(table, new RegExp(control));
  assert.match(page, /hasUrlState \? params/);
  assert.match(page, /preferenceQuery\(saved\)/);
  assert.match(table, /pageSizeOptions=\{\[10, 25, 50, 100\]\}/);
  assert.match(table, /getAll\('column'\)/);
  assert.match(table, /resetRowSelection/);
  assert.match(dataTable, /DataTablePagination/);
  assert.match(toolbar, /DataTableViewOptions/);
});

test('support queue applies advanced operators, multi-value filters, joins, and ordered sorting on the server', () => {
  for (const operator of ['notILike', "operator === 'eq'", "operator === 'ne'", 'isEmpty', 'isNotEmpty', 'isBetween']) assert.match(source, new RegExp(operator));
  assert.match(source, /join === 'or'/);
  assert.match(source, /values\.filter/);
  assert.match(source, /parsedSorts\.slice\(0, 6\)/);
  assert.match(source, /item\.desc \? 'desc' : 'asc'/);
  assert.match(source, /\[10, 25, 50, 100\]\.includes/);
  assert.match(source, /date\.getFullYear\(\)/);
});

test('support queue exposes search, filtered-empty, persistence, pagination reset, loading, and error states', () => {
  const table = readFileSync('app/(dashboard)/admin/support/support-inbox-table.tsx', 'utf8');
  const loading = readFileSync('app/(dashboard)/admin/support/loading.tsx', 'utf8');
  const error = readFileSync('app/(dashboard)/admin/support/error.tsx', 'utf8');
  assert.match(table, /Search member, email, or subject/);
  assert.match(table, /No conversations match this view/);
  assert.match(table, /No support conversations exist/);
  assert.match(table, /persistTablePreferences\('support'/);
  assert.match(table, /params\.delete\('page'\)/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(error, /role|unavailable/);
});

test('assignment and workflow audit events exclude support bodies', () => {
  assert.match(source, /support\.assignment\.changed/);
  assert.match(source, /support\.conversation\.closed/);
  const auditStatements = source.match(/insert into idoc\.audit_log[^;]+/gs) ?? [];
  assert.ok(auditStatements.length >= 2);
  for (const statement of auditStatements) assert.doesNotMatch(statement, /\$\{body\}/);
});
