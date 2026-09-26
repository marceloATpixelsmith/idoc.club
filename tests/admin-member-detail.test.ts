import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/(dashboard)/admin/members/page.tsx', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../app/(dashboard)/admin/members/member-detail-sheet.tsx', import.meta.url), 'utf8');
const table = readFileSync(new URL('../app/(dashboard)/admin/members/members-table.tsx', import.meta.url), 'utf8');
const revenue = readFileSync(new URL('../app/(dashboard)/admin/revenue/page.tsx', import.meta.url), 'utf8');
const paymentsPage = readFileSync(new URL('../app/(dashboard)/admin/payments/page.tsx', import.meta.url), 'utf8');
const notificationsPage = readFileSync(new URL('../app/(dashboard)/admin/notifications/page.tsx', import.meta.url), 'utf8');

test('a selected member opens a tabbed right-side Sheet, not flat anchor-jump sections', () => {
  assert.match(page, /<MemberDetailSheet/);
  assert.doesNotMatch(page, /href="#/);
  assert.match(sheet, /<Sheet /);
  assert.match(sheet, /<Tabs /);
  for (const value of ['overview', 'edit', 'membership', 'payment', 'account', 'notifications', 'audit']) {
    assert.match(sheet, new RegExp(`value="${value}"`));
  }
  assert.match(sheet, /isSuperAdmin && <TabsTrigger value="roles">/);
  assert.match(sheet, /<AdminProfileForm/);
  assert.match(sheet, /<ExtendExpirationForm/);
  assert.match(sheet, /<EntitlementCorrectionForm/);
  assert.match(sheet, /<ManualPaymentForm/);
  assert.match(sheet, /<MembershipRefundForm/);
  assert.match(sheet, /<RolesSection/);
  assert.match(sheet, /<ForceRevokeAllAuthorityForm/);
  assert.match(sheet, /<AdminReadOnlyTable/);
  assert.match(sheet, /mailto:\$\{encodeURIComponent\(selected\.email\)\}/);
  assert.match(sheet, /listAdminSeminarHistoryForMember\b|Seminar history/);
  assert.match(sheet, /Seminar history/);
  assert.doesNotMatch(sheet, /not implemented yet/);
});

test('form sections render as cards in a responsive grid, not a flat vertical stack', () => {
  assert.match(sheet, /grid gap-4 md:grid-cols-2/);
  assert.match(sheet, /function Section\(/);
});

test('the standalone manual-payments route now redirects into the Members Sheet\'s Payment tab', () => {
  assert.match(paymentsPage, /redirect\(/);
  assert.match(paymentsPage, /\/admin\/members\?profileId=\$\{profileId\}&tab=payment/);
  assert.match(paymentsPage, /requireAccountAccess\('administration'\)/);
  assert.match(paymentsPage, /requireAdministrator\(actor\)/);
});

test('the standalone notifications route now redirects into the Members Sheet\'s Notifications tab', () => {
  assert.match(notificationsPage, /redirect\(/);
  assert.match(notificationsPage, /\/admin\/members\?profileId=\$\{profileId\}&tab=notifications/);
  assert.match(notificationsPage, /requireAccountAccess\('administration'\)/);
  assert.match(notificationsPage, /requireAdministrator\(actor\)/);
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
