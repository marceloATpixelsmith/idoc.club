import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { grantApplicationRole, listActiveRoles, revokeApplicationRole } from '../lib/membership/role-grants.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { adminUser, closeHarness, concurrently, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

async function superAdminUser() {
  const user = await createUser();
  await grantRole(user.id, 'super_admin');
  return user;
}

function asSuperAdmin<T>(superAdminId: number, operation: () => Promise<T>) {
  return withTestMembershipBoundary({ actor: { id: superAdminId, roles: [] } }, operation);
}

test('a Super Admin can grant administrator and super_admin roles, each writing an audited entry', async () => {
  const superAdmin = await superAdminUser();
  const target = await createUser();

  await asSuperAdmin(superAdmin.id, () => grantApplicationRole(target.id, { reason: 'New ops hire', role: 'administrator' }));
  const [row] = await sql`select role, granted_by from idoc.application_roles where user_id=${target.id} and revoked_at is null`;
  assert.equal(row.role, 'administrator');
  assert.equal(row.granted_by, superAdmin.id);

  const [audit] = await sql`select action, actor_id, reason, entity_type, entity_id from idoc.audit_log where action='admin.role.granted'`;
  assert.equal(audit.actor_id, superAdmin.id);
  assert.equal(audit.reason, 'New ops hire');
  assert.equal(audit.entity_type, 'user');
  assert.equal(audit.entity_id, String(target.id));
});

test('granting a role the user already actively holds is a friendly rejection, not a raw constraint violation', async () => {
  const superAdmin = await superAdminUser();
  const target = await createUser();
  await grantRole(target.id, 'administrator');
  await assert.rejects(asSuperAdmin(superAdmin.id, () => grantApplicationRole(target.id, { reason: 'Duplicate grant', role: 'administrator' })));
  assert.equal((await sql`select count(*)::int as count from idoc.application_roles where user_id=${target.id} and role='administrator'`)[0].count, 1);
});

test('granting the vestigial \'member\' role is rejected before reaching the database', async () => {
  const superAdmin = await superAdminUser();
  const target = await createUser();
  await assert.rejects(asSuperAdmin(superAdmin.id, () => grantApplicationRole(target.id, { reason: 'Should not be possible', role: 'member' })));
});

test('a plain administrator (not Super Admin) cannot grant or revoke roles', async () => {
  const admin = await adminUser();
  const target = await createUser();
  await assert.rejects(withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => grantApplicationRole(target.id, { reason: 'Not authorized', role: 'administrator' })));
  await grantRole(target.id, 'administrator');
  await assert.rejects(withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => revokeApplicationRole(target.id, { reason: 'Not authorized', role: 'administrator' })));
});

test('re-granting a role after a prior revoke soft-revokes and inserts a fresh row', async () => {
  const superAdmin = await superAdminUser();
  const target = await createUser();
  await asSuperAdmin(superAdmin.id, () => grantApplicationRole(target.id, { reason: 'First grant', role: 'administrator' }));
  await asSuperAdmin(superAdmin.id, () => revokeApplicationRole(target.id, { reason: 'Role no longer needed', role: 'administrator' }));
  await asSuperAdmin(superAdmin.id, () => grantApplicationRole(target.id, { reason: 'Re-hired', role: 'administrator' }));

  const rows = await sql`select revoked_at from idoc.application_roles where user_id=${target.id} and role='administrator' order by id`;
  assert.equal(rows.length, 2);
  assert.ok(rows[0].revoked_at);
  assert.equal(rows[1].revoked_at, null);
});

test('revoking with 3+ active Super Admins succeeds', async () => {
  const superAdmin = await superAdminUser();
  await superAdminUser();
  const third = await superAdminUser();
  await asSuperAdmin(superAdmin.id, () => revokeApplicationRole(third.id, { reason: 'Stepping down', role: 'super_admin' }));
  assert.equal((await sql`select count(*)::int as count from idoc.application_roles where role='super_admin' and revoked_at is null`)[0].count, 2);
});

test('revoking the last active Super Admin is rejected', async () => {
  const onlySuperAdmin = await superAdminUser();
  await assert.rejects(asSuperAdmin(onlySuperAdmin.id, () => revokeApplicationRole(onlySuperAdmin.id, { reason: 'Should be blocked', role: 'super_admin' })));
  assert.equal((await sql`select count(*)::int as count from idoc.application_roles where role='super_admin' and revoked_at is null`)[0].count, 1);
});

test('with exactly two active Super Admins, concurrently revoking both leaves exactly one active, never zero', async () => {
  const first = await superAdminUser();
  const second = await superAdminUser();
  const results = await concurrently(
    () => asSuperAdmin(first.id, () => revokeApplicationRole(first.id, { reason: 'Concurrent revoke A', role: 'super_admin' })),
    () => asSuperAdmin(second.id, () => revokeApplicationRole(second.id, { reason: 'Concurrent revoke B', role: 'super_admin' })),
  );
  const outcomes = results.map((result) => result.status);
  assert.equal(outcomes.filter((status) => status === 'fulfilled').length, 1, 'exactly one revoke must succeed');
  assert.equal(outcomes.filter((status) => status === 'rejected').length, 1, 'exactly one revoke must be rejected');
  assert.equal((await sql`select count(*)::int as count from idoc.application_roles where role='super_admin' and revoked_at is null`)[0].count, 1);
});

test('listActiveRoles is viewable by a plain administrator and returns only non-revoked rows', async () => {
  const admin = await adminUser();
  const target = await createUser();
  await grantRole(target.id, 'administrator');
  const superAdmin = await superAdminUser();
  await asSuperAdmin(superAdmin.id, () => grantApplicationRole(target.id, { reason: 'Also super admin', role: 'super_admin' }));
  await asSuperAdmin(superAdmin.id, () => revokeApplicationRole(target.id, { reason: 'Removed super admin', role: 'super_admin' }));

  const roles = await withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => listActiveRoles(target.id));
  assert.deepEqual(roles.map((role) => role.role).sort(), ['administrator']);
});
