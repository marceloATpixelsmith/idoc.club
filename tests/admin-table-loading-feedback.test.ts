import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const members = readFileSync('app/(dashboard)/admin/members/members-table.tsx', 'utf8');

test('member action buttons retain transition-driven loading feedback', () => {
  assert.match(members, /function openMember\(event: MouseEvent, href: string\)/);
  assert.match(members, /onClick=\{\(event\) => openMember\(event, `\$\{pathname\}\?profileId=\$\{row\.original\.profileId\}`\)\}/);
  assert.match(members, /onClick=\{\(event\) => openMember\(event, `\$\{pathname\}\?profileId=\$\{row\.original\.profileId\}&tab=payment`\)\}/);
});
