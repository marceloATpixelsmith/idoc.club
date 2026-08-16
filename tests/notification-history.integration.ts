import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { listNotificationHistory } from '../lib/membership/data-access.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { adminUser, asAdmin, closeHarness, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('listNotificationHistory returns an administrator every row for the member, newest first', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.notification_outbox(profile_id, kind, payload, created_at) values (${profile.id}, 'membership.renewal_reminder', '{}', now() - interval '1 minute')`;
  await sql`insert into idoc.notification_outbox(profile_id, kind, payload, created_at) values (${profile.id}, 'membership.expiration_reminder', '{}', now())`;

  const history = await asAdmin(admin.id, () => listNotificationHistory(profile.id));
  assert.equal(history.length, 2);
  assert.equal(history[0].kind, 'membership.expiration_reminder');
  assert.equal(history[1].kind, 'membership.renewal_reminder');
});

test('listNotificationHistory returns no rows for a member with no notification history', async () => {
  const admin = await adminUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  const history = await asAdmin(admin.id, () => listNotificationHistory(profile.id));
  assert.deepEqual(history, []);
});

test('a non-administrator cannot read notification history', async () => {
  const nonAdmin = await createUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await assert.rejects(withTestMembershipBoundary({ actor: { id: nonAdmin.id, roles: [] } }, () => listNotificationHistory(profile.id)));
});
