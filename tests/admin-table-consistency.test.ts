import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const members = readFileSync('app/(dashboard)/admin/members/members-table.tsx', 'utf8');
const resources = readFileSync('components/admin/resource-data-table.tsx', 'utf8');
const registrations = readFileSync('app/(dashboard)/admin/seminars/registrations/registrations-table.tsx', 'utf8');
const registrationForm = readFileSync('app/(dashboard)/admin/seminars/registrations/registration-detail-sheet.tsx', 'utf8');
const support = readFileSync('app/(dashboard)/admin/support/support-inbox-table.tsx', 'utf8');

test('record text in admin tables is not used as the edit/open link', () => {
  assert.doesNotMatch(members, /className="font-medium uppercase underline"/);
  assert.doesNotMatch(resources, /id === 'title'[\s\S]*?<Link className="font-medium underline"/);
  assert.doesNotMatch(registrations, /seminar_title[\s\S]{0,500}<Link className="font-medium underline"/);
  assert.doesNotMatch(support, /id: 'subject'[\s\S]{0,500}<Link className="font-medium underline"/);
  assert.doesNotMatch(support, /id: 'member'[\s\S]{0,600}<Link className="font-medium underline"/);
});

test('requested default column order applies only when no saved order is supplied', () => {
  assert.match(members, /initialColumnOrder\?\.split\(','\) \?\? defaultColumnOrder/);
  assert.match(members, /\['select', 'name', 'status', 'type', 'expires', 'region'/);
  assert.match(resources, /\['select', 'title', 'status', 'prices', 'start', 'end', 'deadline', 'registrations', 'actions'\]/);
  assert.match(registrations, /\['select', 'registered', 'registrant', 'seminar', 'status', 'actions'\]/);
  assert.match(support, /\['select', 'activity', 'assigned', 'category', 'subject', 'member', 'status', 'actions'\]/);
});

test('registration search wording is concise', () => {
  assert.match(registrations, /placeholder="Search name or email…"/);
  assert.doesNotMatch(registrations, /Search registrant name or email/);
});

test('registration table and form use branded payment method icons', () => {
  assert.match(registrations, /<PaymentMethodIcon method=\{row\.original\.payment_method_canonical_id\}/);
  assert.match(registrationForm, /<PaymentMethodSelect[\s\S]*?id="paymentMethod"/);
  assert.match(registrationForm, /<PaymentMethodSelect[\s\S]*?id="method"/);
});

test('Judge icon remains the sitewide bell in the admin members table', () => {
  assert.match(members, /judge: \{ icon: Bell/);
  assert.doesNotMatch(members, /\bGavel\b/);
});

test('active admin role icons appear in gold directly after the member name', () => {
  const memberQueries = readFileSync('lib/membership/admin-memberships.ts', 'utf8');
  assert.match(members, /row\.original\.isSuperAdmin && <Shield aria-label="Super Admin" className="size-4 shrink-0 text-gold"/);
  assert.match(members, /row\.original\.isAdministrator && <UserCog aria-label="Administrator" className="size-4 shrink-0 text-gold"/);
  assert.match(memberQueries, /coalesce\(app_roles\.is_administrator,false\) "isAdministrator"/);
  assert.match(memberQueries, /coalesce\(app_roles\.is_super_admin,false\) "isSuperAdmin"/);
  assert.match(memberQueries, /where user_id=u\.id and revoked_at is null\) app_roles/);
});
