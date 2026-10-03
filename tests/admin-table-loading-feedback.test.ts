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
