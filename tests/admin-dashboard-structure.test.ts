import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminLayout = readFileSync('app/(dashboard)/admin/layout.tsx', 'utf8');
const navigation = readFileSync('components/admin-navigation.tsx', 'utf8');
const organizationLayout = readFileSync('app/(dashboard)/admin/organization/layout.tsx', 'utf8');
const securityLayout = readFileSync('app/(dashboard)/admin/security/layout.tsx', 'utf8');
const supportDefaultsLayout = readFileSync('app/(dashboard)/admin/support/defaults/layout.tsx', 'utf8');

test('admin dashboard uses branded responsive navigation after server authorization', () => {
  assert.match(adminLayout, /requireAccountAccess\('administration'\)/);
  assert.match(adminLayout, /requireAdministrator\(actor\)/);
  assert.match(adminLayout, /<AdminNavigation isSuperAdmin=\{actor\.roles\.includes\('super_admin'\)\}/);
  assert.match(navigation, /IDOC administration/);
  assert.match(navigation, /lg:w-72/);
  assert.match(navigation, /aria-label="Admin Dashboard"/);
});

test('shared administrator functions precede conditional Super Admin functions', () => {
  assert.ok(navigation.indexOf('const SHARED_ITEMS') < navigation.indexOf('const SUPER_ADMIN_ITEMS'));
  assert.match(navigation, /isSuperAdmin \? \[\.\.\.SHARED_ITEMS, \.\.\.SUPER_ADMIN_ITEMS\] : SHARED_ITEMS/);
  assert.match(navigation, /Super Admin/);
  for (const icon of ['Users', 'CreditCard', 'FileDown', 'Building2', 'ShieldCheck']) {
    assert.match(navigation, new RegExp(`icon: ${icon}`));
  }
});

test('every Super Admin page independently maps insufficient authority to branded not-found', () => {
  for (const layout of [organizationLayout, securityLayout, supportDefaultsLayout]) {
    assert.match(layout, /requireAccountAccess\('administration'\)/);
    assert.match(layout, /requireSuperAdmin\(actor\)/);
    assert.match(layout, /notFound\(\)/);
  }
});
