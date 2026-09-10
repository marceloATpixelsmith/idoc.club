import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/(dashboard)/admin/members/page.tsx', import.meta.url), 'utf8');
const table = readFileSync(new URL('../app/(dashboard)/admin/members/members-table.tsx', import.meta.url), 'utf8');
const revenue = readFileSync(new URL('../app/(dashboard)/admin/revenue/page.tsx', import.meta.url), 'utf8');

test('selected-member actions use canonical links and real seminar history', () => {
  for (const label of ['View Payment History', 'Record Manual Payment', 'Extend Expiration Date',
    'Edit Member Information', 'Change Membership Type', 'Email Member', 'View Seminars']) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /mailto:\$\{encodeURIComponent\(selected\.email\)\}/);
  assert.match(page, /listAdminSeminarHistoryForMember/);
  assert.match(page, /Seminar history/);
  assert.doesNotMatch(page, /not implemented yet/);
});

test('table exposes integrated selection without presenting deferred external mutations as actions', () => {
  assert.match(table, /Select all members on this page/);
  assert.match(table, /Clear selection/);
  assert.match(table, /<ActionBar/);
  assert.doesNotMatch(table, /Archive Membership|Pause Membership|Revoke User Access/);
});

test('revenue UI refuses to attribute historical payments from current classifications', () => {
  assert.match(revenue, /payment records do not snapshot the member classification at payment time/);
  assert.match(revenue, /Current classifications are not used as historical substitutes/);
});
