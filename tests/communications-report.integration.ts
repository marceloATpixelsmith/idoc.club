import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { adminUser, asAdmin, closeHarness, createMembership, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';
import { getCommunicationsReport } from '../lib/notifications/communications-report-data.ts';
import { listNewMembersLastWeek } from '../lib/membership/new-members.ts';

beforeEach(resetIdoc);
after(closeHarness);

// These pages failed on staging because the database client rejected Date parameters; only a real PostgreSQL run catches that.
test('the Communications report runs against PostgreSQL: weekly totals, renewal split, and upcoming notices', async () => {
  delete process.env.BREVO_API_KEY; // never call Brevo from a test
  const admin = await adminUser();
  const user = await createUser();
  const profile = await createProfile(user.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source)
    values(${profile.id},'active','2025-01-01',(now()::date + 20),'migration')`;
  await sql`insert into idoc.notification_outbox(kind,profile_id,payload,sent_at) values
    ('membership.payment_failed',${profile.id},${JSON.stringify({ to: user.email })}::jsonb,now() - interval '1 day'),
    ('membership.renewal_reminder',${profile.id},${JSON.stringify({ to: user.email })}::jsonb,now() - interval '2 days'),
    ('membership.grace_expired',${profile.id},${JSON.stringify({ to: user.email })}::jsonb,null)`;
  const report = await asAdmin(admin.id, () => getCommunicationsReport());
  assert.equal(report.brevoAvailable, false);
  assert.deepEqual(report.systemTotals.map((row) => [row.kind, row.sent, row.pending]).sort(), [['membership.grace_expired', 0, 1], ['membership.payment_failed', 1, 0]]);
  assert.deepEqual(report.renewalTotals.map((row) => [row.kind, row.sent]), [['membership.renewal_reminder', 1]]);
  assert.equal(report.renewalRows.length, 1);
  assert.ok(report.renewalRows[0].sentAt instanceof Date && report.renewalRows[0].sentAt.toISOString());
  assert.ok(report.upcoming.some((row) => row.kind === 'membership.expiration_reminder' && row.email === user.email));
});

test('the new-members summary runs against PostgreSQL and counts only the last seven days', async () => {
  const admin = await adminUser();
  const recent = await createUser();
  await createProfile(recent.id);
  const old = await createUser();
  const oldProfile = await createProfile(old.id);
  await sql`update idoc.profiles set created_at = now() - interval '30 days' where id = ${oldProfile.id}`;
  await createMembership(oldProfile.id);
  const summary = await asAdmin(admin.id, () => listNewMembersLastWeek());
  assert.equal(summary.total, 1);
  assert.equal(summary.recent.length, 1);
  assert.ok(summary.recent[0].joinedAt.toISOString());
  assert.deepEqual(summary.byClassification, [{ count: 1, label: 'judges' }]);
});
