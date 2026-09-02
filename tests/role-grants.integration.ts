import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { grantApplicationRole, listActiveRoles, revokeApplicationRole } from '../lib/membership/role-grants.ts';
import { suspendUserAccount } from '../lib/membership/account-suspension.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { adminUser, asAdmin, closeHarness, concurrently, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

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

  const [before] = await sql`select session_version from idoc.users where id=${target.id}`;
  await asSuperAdmin(superAdmin.id, () => grantApplicationRole(target.id, { reason: 'New ops hire', role: 'administrator' }));
  const [row] = await sql`select role, granted_by from idoc.application_roles where user_id=${target.id} and revoked_at is null`;
  assert.equal(row.role, 'administrator');
  assert.equal(row.granted_by, superAdmin.id);

  const [audit] = await sql`select action, actor_id, reason, entity_type, entity_id from idoc.audit_log where action='admin.role.granted'`;
  assert.equal(audit.actor_id, superAdmin.id);
  assert.equal(audit.reason, 'New ops hire');
  assert.equal(audit.entity_type, 'user');
  assert.equal(audit.entity_id, String(target.id));

  // AUTH-AUTHZ-005: a privileged role grant must invalidate the target's existing session
  // authority, not merely record the grant -- proven here against real Postgres, not just the
  // regex assertion in role-grant-session-invalidation.test.ts.
  const [after] = await sql`select session_version from idoc.users where id=${target.id}`;
  assert.equal(after.session_version, before.session_version + 1);
});

test('revoking a role also increments the target\'s session version, invalidating any session issued under the old grant', async () => {
  const superAdmin = await superAdminUser();
  const target = await createUser();
  await asSuperAdmin(superAdmin.id, () => grantApplicationRole(target.id, { reason: 'First grant', role: 'administrator' }));
  const [beforeRevoke] = await sql`select session_version from idoc.users where id=${target.id}`;

  await asSuperAdmin(superAdmin.id, () => revokeApplicationRole(target.id, { reason: 'Role no longer needed', role: 'administrator' }));
  const [afterRevoke] = await sql`select session_version from idoc.users where id=${target.id}`;
  assert.equal(afterRevoke.session_version, beforeRevoke.session_version + 1);

  const [audit] = await sql`select actor_id, reason from idoc.audit_log where action='admin.role.revoked' and entity_id=${String(target.id)}`;
  assert.equal(audit.actor_id, superAdmin.id);
  assert.equal(audit.reason, 'Role no longer needed');
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

test('a role cannot be granted to a suspended or deleted account', async () => {
  const superAdmin = await superAdminUser();
  const suspended = await createUser('active');
  const admin = await adminUser();
  await asAdmin(admin.id, () => suspendUserAccount(suspended.id, 'Compromised credentials'));
  await assert.rejects(
    asSuperAdmin(superAdmin.id, () => grantApplicationRole(suspended.id, { reason: 'Should be blocked', role: 'administrator' })),
    /suspended or deleted/,
  );
  assert.equal((await sql`select count(*)::int as count from idoc.application_roles where user_id=${suspended.id}`)[0].count, 0);

  const deleted = await createUser('deleted');
  await assert.rejects(
    asSuperAdmin(superAdmin.id, () => grantApplicationRole(deleted.id, { reason: 'Should be blocked', role: 'administrator' })),
    /suspended or deleted/,
  );
});

test('a role grant that starts before a concurrent suspension of the same user cannot complete after the suspension commits, so no account ends up suspended with an active grant', async () => {
  // A Codex review on marceloATpixelsmith/idoc.club#104 caught that, before this test's guard
  // existed, grantApplicationRole's INSERT into application_roles was not blocked by
  // suspendUserAccount's row lock on `users` (a different table), so suspension could commit having
  // read no active grant, followed by the grant's own users-row UPDATE finally proceeding once that
  // lock released -- leaving a suspended account with an active administrator grant underneath.
  // grantApplicationRole now takes the same `users` row lock, before touching application_roles at
  // all, making the two operations mutually exclusive: whichever call reaches the lock first
  // determines the outcome the other must respect.
  const superAdmin = await superAdminUser();
  const admin = await adminUser();
  const target = await createUser('active');

  const results = await concurrently(
    () => asSuperAdmin(superAdmin.id, () => grantApplicationRole(target.id, { reason: 'Promotion', role: 'administrator' })),
    () => asAdmin(admin.id, () => suspendUserAccount(target.id, 'Compromised credentials')),
  );
  const outcomes = results.map((result) => result.status);

  const [user] = await sql`select account_state from idoc.users where id=${target.id}`;
  const activeGrants = (await sql`select count(*)::int as count from idoc.application_roles where user_id=${target.id} and revoked_at is null`)[0].count;

  if (user.account_state === 'suspended') {
    // Suspension won the race: it must have found no active grant, and the grant attempt must have
    // been rejected (either because suspension's lock made it see the now-suspended state, or -- if
    // it ran first and inserted, hit the row lock -- but then it would have committed and the
    // suspension check for an active grant would have thrown instead; the assertion below is the
    // actual invariant that matters regardless of which interleaving occurred).
    assert.equal(activeGrants, 0, 'a suspended account must never carry an active role grant');
  } else {
    // The grant won the race and committed first; suspension must then see it and refuse to proceed.
    assert.equal(outcomes[1], 'rejected', 'suspension must be rejected once an active grant exists');
    assert.equal(activeGrants, 1);
  }
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
