import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminProfile = readFileSync('app/(dashboard)/admin/members/admin-profile-form.tsx', 'utf8');
const organizationSettings = readFileSync('app/(dashboard)/admin/organization/organization-settings-form.tsx', 'utf8');
const seminarFieldset = readFileSync('components/seminars/seminar-fieldset.tsx', 'utf8');
const supportDrawer = readFileSync('app/(dashboard)/admin/support/support-detail-drawer.tsx', 'utf8');
const membersTable = readFileSync('app/(dashboard)/admin/members/members-table.tsx', 'utf8');
const membershipPage = readFileSync('app/(dashboard)/dashboard/membership/page.tsx', 'utf8');
const formToggle = readFileSync('components/ui/form-toggle.tsx', 'utf8');
const professionalRoleIcons = readFileSync('components/membership/professional-role-icons.tsx', 'utf8');

test('admin boolean data fields use the shared toggle control', () => {
  assert.match(formToggle, /type="checkbox"/);
  assert.match(formToggle, /peer-checked:bg-gold/);

  assert.match(adminProfile, /<FormToggle defaultChecked=\{Boolean\(judge\?\.isTechnicalDelegate\)\}[^>]*name="isTechnicalDelegate"[^>]*value="yes"/s);
  assert.match(adminProfile, /<FormToggle[\s\S]*?name="isBoardMember"[\s\S]*?value="1"/);
  assert.doesNotMatch(adminProfile, /values=\{\['yes', 'no'\]\}/);

  assert.match(organizationSettings, /<FormToggle checked=\{bankEnabled\}[^>]*name="bankEnabled"/s);
  assert.match(organizationSettings, /<FormToggle defaultChecked=\{cash\.enabled\}[^>]*name="cashEnabled"/s);
  assert.match(seminarFieldset, /<FormToggle defaultChecked=\{seminar\?\.is_fei \?\? false\}[^>]*name="isFei"/s);
  assert.match(supportDrawer, /<FormToggle[\s\S]*?name="closed"[\s\S]*?value="1"/);
});

test('judge and steward official-status choices occupy their own horizontal rows', () => {
  assert.match(adminProfile, /<div className="col-span-2">\s*<CheckboxGroup horizontal[^>]*label="Official Status as Judge"/s);
  assert.match(adminProfile, /<div className="col-span-2">\s*<FormToggle[^>]*label="Technical Delegate"/s);
  assert.match(adminProfile, /<CheckboxGroup horizontal[^>]*label="Official Status as Steward"/s);
  assert.match(adminProfile, /horizontal \? 'flex flex-wrap gap-x-5 gap-y-3'/);
});

test('steward displays use the shared horseshoe icon instead of a generic flag', () => {
  assert.match(professionalRoleIcons, /export function HorseshoeIcon/);
  assert.match(professionalRoleIcons, /<path d="M5 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3H5Z"/);

  assert.match(membersTable, /steward: \{ icon: HorseshoeIcon, label: 'STEWARD' \}/);
  assert.match(membershipPage, /if \(types\.has\('steward'\)\) return \{ icon: <HorseshoeIcon/);
  assert.doesNotMatch(membershipPage, /\bFlag\b/);
});
