import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { listAllAuditLogForExport, listAllMembersForExport, listAllNotificationsForExport, listAllPaymentsForExport } from '../lib/membership/exports.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { GET as exportAuditLog } from '../app/api/admin/export/audit-log/route.ts';
import { GET as exportMembers } from '../app/api/admin/export/members/route.ts';
import { GET as exportPayments } from '../app/api/admin/export/payments/route.ts';
import {
  adminUser, closeHarness, createMembership, createProfile, createUser, grantRole, resetIdoc, sql,
} from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

async function superAdminUser() {
  const user = await createUser();
  await grantRole(user.id, 'super_admin');
  return user;
}

function asAdministration<T>(actorId: number, operation: () => Promise<T>) {
  return withTestMembershipBoundary({ actor: { id: actorId, roles: [] } }, operation);
}

test('listAllMembersForExport includes a profile with zero memberships alongside one with a membership', async () => {
  const admin = await adminUser();
  const withMembership = await createUser();
  const withMembershipProfile = await createProfile(withMembership.id);
  await createMembership(withMembershipProfile.id, true);
  const withoutMembership = await createUser();
  await createProfile(withoutMembership.id);

  const rows = await asAdministration(admin.id, () => listAllMembersForExport());
  assert.equal(rows.length, 2);
  const withMembershipRow = rows.find((row) => row.email === withMembership.email);
  const withoutMembershipRow = rows.find((row) => row.email === withoutMembership.email);
  assert.equal(withMembershipRow?.status, 'active');
  assert.equal(withMembershipRow?.validUntil, '2099-12-31');
  assert.equal(withoutMembershipRow?.status, null);
  assert.equal(withoutMembershipRow?.validUntil, null);
});

test('listAllPaymentsForExport requires Super Admin, not just Administrator', async () => {
  const admin = await adminUser();
  const superAdmin = await superAdminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.payments(profile_id, source, amount_cents, currency, paid_at, administrator_id, reason)
    values (${profile.id}, 'cash', 8000, 'EUR', now(), ${admin.id}, 'fixture payment')`;

  await assert.rejects(asAdministration(admin.id, () => listAllPaymentsForExport()));
  const rows = await asAdministration(superAdmin.id, () => listAllPaymentsForExport());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'cash');
  assert.equal(rows[0].email, member.email);
});

test('listAllAuditLogForExport requires Super Admin, not just Administrator', async () => {
  const admin = await adminUser();
  const superAdmin = await superAdminUser();
  await sql`insert into idoc.audit_log(actor_id, action, entity_type, entity_id) values (${admin.id}, 'test.action', 'user', ${String(admin.id)})`;

  await assert.rejects(asAdministration(admin.id, () => listAllAuditLogForExport()));
  const rows = await asAdministration(superAdmin.id, () => listAllAuditLogForExport());
  assert.equal(rows.length, 1);
});

test('listAllNotificationsForExport is reachable by a plain Administrator', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.notification_outbox(profile_id, kind, payload) values (${profile.id}, 'membership.renewal_reminder', '{}')`;

  const rows = await asAdministration(admin.id, () => listAllNotificationsForExport());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, member.email);
  assert.equal(rows[0].kind, 'membership.renewal_reminder');
});

test('no export function is reachable by a non-administrator', async () => {
  const nonAdmin = await createUser();
  await assert.rejects(asAdministration(nonAdmin.id, () => listAllMembersForExport()));
  await assert.rejects(asAdministration(nonAdmin.id, () => listAllPaymentsForExport()));
  await assert.rejects(asAdministration(nonAdmin.id, () => listAllAuditLogForExport()));
  await assert.rejects(asAdministration(nonAdmin.id, () => listAllNotificationsForExport()));
});

test('the members export route returns CSV with the correct headers for an administrator', async () => {
  const admin = await adminUser();
  const member = await createUser();
  await createProfile(member.id);

  const response = await asAdministration(admin.id, () => exportMembers());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  assert.match(response.headers.get('Content-Disposition') ?? '', /attachment; filename="members\.csv"/);
  const body = await response.text();
  assert.match(body, /firstName,lastName,email,status,validUntil/);
});

test('the payments export route rejects a plain administrator with a 401, and succeeds for a Super Admin', async () => {
  const admin = await adminUser();
  const superAdmin = await superAdminUser();

  const forbidden = await asAdministration(admin.id, () => exportPayments());
  assert.equal(forbidden.status, 401);

  const allowed = await asAdministration(superAdmin.id, () => exportPayments());
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('Content-Type'), 'text/csv; charset=utf-8');
});

test('the audit-log export route rejects a plain administrator with a 401, and succeeds for a Super Admin', async () => {
  const admin = await adminUser();
  const superAdmin = await superAdminUser();

  const forbidden = await asAdministration(admin.id, () => exportAuditLog());
  assert.equal(forbidden.status, 401);

  const allowed = await asAdministration(superAdmin.id, () => exportAuditLog());
  assert.equal(allowed.status, 200);
});
