import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/(dashboard)/admin/members/page.tsx', import.meta.url), 'utf8');
const bulk = readFileSync(new URL('../app/(dashboard)/admin/members/bulk-member-selection.tsx', import.meta.url), 'utf8');
const revenue = readFileSync(new URL('../app/(dashboard)/admin/revenue/page.tsx', import.meta.url), 'utf8');

test('selected-member actions use canonical links and honest seminar dependency copy', () => {
  for (const label of ['View Payment History', 'Record Manual Payment', 'Extend Expiration Date',
    'Edit Member Information', 'Change Membership Type', 'Email Member', 'View Seminars']) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /mailto:\$\{encodeURIComponent\(selected\.email\)\}/);
  assert.match(page, /Seminar registrations are not implemented yet/);
  assert.doesNotMatch(page, /seminarRegistrations|fabricatedRegistration/);
});

test('bulk controls remain unavailable and describe their distinct dependencies', () => {
  assert.match(bulk, /MAX_ADMIN_MEMBER_BATCH_SIZE = 50/);
  assert.match(bulk, /Bulk Revoke — unavailable/);
  assert.match(bulk, /Archive Membership — unavailable/);
  assert.match(bulk, /Pause Membership — unavailable/);
  assert.equal((bulk.match(/disabled type="button"/g) ?? []).length, 3);
});

test('revenue UI refuses to attribute historical payments from current classifications', () => {
  assert.match(revenue, /payment records do not snapshot the member classification at payment time/);
  assert.match(revenue, /Current classifications are not used as historical substitutes/);
});
