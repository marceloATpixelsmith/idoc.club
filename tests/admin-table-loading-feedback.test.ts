import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const members = readFileSync('app/(dashboard)/admin/members/members-table.tsx', 'utf8');

test('member action buttons retain transition-driven loading feedback', () => {
  assert.match(members, /function openMember\(event: MouseEvent, href: string\)/);
  assert.match(members, /onClick=\{\(event\) => openMember\(event, `\$\{pathname\}\?profileId=\$\{row\.original\.profileId\}`\)\}/);
  assert.match(members, /onClick=\{\(event\) => openMember\(event, `\$\{pathname\}\?profileId=\$\{row\.original\.profileId\}&tab=payment`\)\}/);
});

const dataTable = readFileSync('components/data-table/data-table.tsx', 'utf8');
const bulkDelete = readFileSync('components/admin/bulk-delete-selected.tsx', 'utf8');
const bulkUpdate = readFileSync('components/admin/bulk-update-selected.tsx', 'utf8');
const publicHome = readFileSync('app/(marketing)/page.tsx', 'utf8');

test('bulk mutations show the shared pulsing table skeleton and refresh after success', () => {
  assert.match(dataTable, /DataTableMutationContext/);
  assert.match(dataTable, /isLoading \? \(/);
  assert.match(bulkDelete, /mutation\.begin\(\)/);
  assert.match(bulkDelete, /mutation\.finish\(Boolean\(state\.success\)\)/);
  assert.equal((bulkUpdate.match(/mutation\.begin\(\)/g) ?? []).length, 2);
  assert.equal((bulkUpdate.match(/mutation\.finish\(Boolean\(result\.success\)\)/g) ?? []).length, 2);
});

test('homepage membership calls to action use shared rounded buttons', () => {
  assert.match(publicHome, /<Button asChild[^>]*>[\s\S]*?<Link href="\/membership">Become a Member<\/Link>/);
  assert.match(publicHome, /<Button asChild[^>]*variant="secondary"[^>]*>[\s\S]*?<Link href="\/sign-in">Member Login<\/Link>/);
});

const bulkActions = readFileSync('app/(dashboard)/admin/bulk-actions.ts', 'utf8');
const memberLifecycle = readFileSync('lib/admin/member-lifecycle.ts', 'utf8');
const archiveMembers = readFileSync('components/admin/bulk-archive-members.tsx', 'utf8');
const memberTable = readFileSync('app/(dashboard)/admin/members/members-table.tsx', 'utf8');
const deletionMigration = readFileSync('lib/db/migrations/0066_member_archive_permanent_delete.sql', 'utf8');

test('member bulk archive is protected and permanently delete removes member data', () => {
  assert.match(memberTable, /<BulkArchiveMembersSelected/);
  assert.match(archiveMembers, /bulkArchiveMembers/);
  assert.match(archiveMembers, /mutation\.begin\(\)/);
  assert.match(bulkDelete, /Permanently delete/);
  assert.match(memberLifecycle, /admin\.member\.permanently_deleted/);
  assert.match(memberLifecycle, /delete from idoc\.users where id in/);
  assert.match(memberLifecycle, /Cancel active billing subscriptions/);
  assert.match(bulkActions, /requireCsrfToken/);
  assert.match(bulkActions, /requireFreshStepUp/);
  assert.match(memberLifecycle, /You cannot delete your own administrator account/);
  assert.match(memberLifecycle, /Administrator accounts cannot be bulk deleted/);
  assert.match(deletionMigration, /ON DELETE SET NULL/);
  assert.match(deletionMigration, /idoc\.allow_member_permanent_delete/);
});
