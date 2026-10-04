import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('lib/support/inbox.ts', 'utf8');
const migration = readFileSync('lib/db/migrations/0039_support_inbox.sql', 'utf8');
const memberThread = readFileSync('components/support/member-support-thread.tsx', 'utf8');

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

test('a saved assignment filter whose values no longer resolve to a real administrator falls back to no filter instead of matching nothing', () => {
  assert.match(source, /const assignedWhere = !assignedValues\.length \|\| !assignedParts\.length \? client`true`/);
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
  const actionsRow = readFileSync('components/data-table/data-table-actions-row.tsx', 'utf8');
  for (const control of ['DataTable', 'DataTableToolbar', 'DataTableActionsRow', 'DataTableSortList', 'useDataTable', 'ActionBar']) assert.match(table, new RegExp(control));
  assert.doesNotMatch(table, /DataTableAdvancedToolbar|DataTableFilterList/);
  assert.match(page, /const saved = await getTablePreferences\('support'\);/);
  assert.doesNotMatch(page, /hasUrlState/);
  assert.match(table, /pageSizeOptions=\{\[10, 25, 50, 100\]\}/);
  assert.match(table, /initialVisibleColumns\.includes\(column\)/);
  assert.match(table, /resetRowSelection/);
  assert.match(dataTable, /DataTablePagination/);
  assert.match(actionsRow, /DataTableViewOptions/);
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
  // The navigation must fire only after the preference write settles -- a fire-and-forget PUT
  // racing an immediate navigation can read the database before the write commits. It navigates
  // to the bare pathname (not router.refresh(), which reuses whatever URL is currently shown) so
  // the one-time `memberEmail` query param is dropped on the admin's first edit here.
  assert.match(table, /\}\)\.finally\(\(\) => startTransition\(\(\) => router\.replace\(pathname\)\)\);/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(error, /AdminErrorState/);
});

test('assignment and workflow audit events exclude support bodies', () => {
  assert.match(source, /support\.assignment\.changed/);
  assert.match(source, /support\.conversation\.closed/);
  const auditStatements = source.match(/insert into idoc\.audit_log[^;]+/gs) ?? [];
  assert.ok(auditStatements.length >= 2);
  for (const statement of auditStatements) assert.doesNotMatch(statement, /\$\{body\}/);
});

test('a member can close their own conversation, mirroring the admin workflow action but scoped to a conversation they actually own -- once an administrator\'s fix is confirmed working, the member doesn\'t need an admin to close it out for them', () => {
  assert.match(source, /export async function setOwnConversationClosed\(publicIdValue: unknown, close: boolean\)/);
  const fn = source.slice(source.indexOf('export async function setOwnConversationClosed'));
  assert.match(fn, /const actor = await requireSupportMember\(\);/);
  assert.match(fn, /where public_id=\$\{publicId\}::uuid and member_user_id=\$\{actor\.id\} for update/);
  const memberActions = readFileSync(new URL('../app/(dashboard)/dashboard/support/actions.ts', import.meta.url), 'utf8');
  assert.match(memberActions, /export async function closeOwnConversation/);
  assert.match(memberActions, /setOwnConversationClosed\(publicId, true\)/);
  assert.match(memberThread, /closeOwnConversation/);
  assert.match(memberThread, /<BackLink href="\/contact">Back to My Support Tickets<\/BackLink>/);
  assert.match(memberThread, /Close conversation/);
});

test('the member close action is close-only and never reads a client-supplied direction -- a member submitting the form with a tampered or missing field can\'t reopen their own conversation, since docs/08\'s Support Inbox contract reserves reopening for administrators', () => {
  const memberActions = readFileSync(new URL('../app/(dashboard)/dashboard/support/actions.ts', import.meta.url), 'utf8');
  const fn = memberActions.slice(memberActions.indexOf('export async function closeOwnConversation'));
  assert.doesNotMatch(fn, /formData\.get\('operation'\)/);
  assert.doesNotMatch(memberThread, /name="operation"/);
});
