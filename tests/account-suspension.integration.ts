import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { reinstateUserAccount, suspendUserAccount } from '../lib/membership/account-suspension.ts';
import { adminUser, asAdmin, closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

async function seedActiveSession(userId: number) {
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
    values(${crypto.randomUUID()},${userId},0,${now.toISOString()},${now.toISOString()},${absoluteExpiresAt.toISOString()})`;
}

async function seedTrustedDevice(userId: number) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  await sql`insert into idoc.login_trusted_devices(trusted_device_id,user_id,application_id,token_digest,session_version_at_issue,issued_at,expires_at)
    values(${crypto.randomUUID()},${userId},'idoc.club',${crypto.randomUUID()},0,${now.toISOString()},${expiresAt.toISOString()})`;
}

test('suspending an active account sets account_state, bumps session_version, revokes sessions and trusted devices, writes audit and notification', async () => {
  const admin = await adminUser();
  const member = await createUser('active');
  await seedActiveSession(member.id);
  await seedTrustedDevice(member.id);

  await asAdmin(admin.id, () => suspendUserAccount(member.id, 'Suspected credential compromise'));

  const [user] = await sql`select account_state, session_version from idoc.users where id=${member.id}`;
  assert.equal(user.account_state, 'suspended');
  assert.equal(user.session_version, 1);

  const [session] = await sql`select revoked_at, revoke_reason from idoc.auth_sessions where user_id=${member.id}`;
  assert.ok(session.revoked_at);
  assert.equal(session.revoke_reason, 'account-suspended');

  const [device] = await sql`select revoked_at, revoke_reason from idoc.login_trusted_devices where user_id=${member.id}`;
  assert.ok(device.revoked_at);
  assert.equal(device.revoke_reason, 'account-suspended');

  const [audit] = await sql`select action, actor_id, reason, entity_type, entity_id, before_json, after_json from idoc.audit_log where action='admin.account.suspended'`;
  assert.equal(audit.actor_id, admin.id);
  assert.equal(audit.reason, 'Suspected credential compromise');
  assert.equal(audit.entity_type, 'user');
  assert.equal(audit.entity_id, String(member.id));
  assert.deepEqual(audit.before_json, { accountState: 'active' });
  assert.deepEqual(audit.after_json, { accountState: 'suspended' });

  const [notification] = await sql`select kind, user_id, recipient_email from idoc.auth_security_notification_outbox where kind='account_suspended'`;
  assert.equal(notification.user_id, member.id);
  assert.equal(notification.recipient_email, member.email);
});

test('retrying suspension on an already-suspended account succeeds idempotently: no duplicate audit row, no duplicate notification, and the retry still (re-)runs session/device revocation', async () => {
  const admin = await adminUser();
  const member = await createUser('active');
  await asAdmin(admin.id, () => suspendUserAccount(member.id, 'First attempt'));

  // Simulate the exact scenario a Codex review on this PR flagged: the state transition committed,
  // but a session/device that only appeared afterward (e.g. because revocation partially failed and
  // this row was never reached) is still unrevoked when the action is retried.
  await seedActiveSession(member.id);

  await asAdmin(admin.id, () => suspendUserAccount(member.id, 'Retry after a partial failure'));

  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where entity_id=${String(member.id)}`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.auth_security_notification_outbox where user_id=${member.id} and kind='account_suspended'`)[0].count, 1);
  const revoked = await sql`select revoked_at from idoc.auth_sessions where user_id=${member.id}`;
  assert.equal(revoked.length, 1);
  assert.ok(revoked[0].revoked_at, 'the session seeded after the first suspension call must still be revoked by the retry');
  const [user] = await sql`select session_version from idoc.users where id=${member.id}`;
  assert.equal(user.session_version, 1, 'the retry must not bump session_version a second time');
});

for (const accountState of ['deleted', 'unverified'] as const) {
  test(`suspending a ${accountState} account is rejected`, async () => {
    const admin = await adminUser();
    const member = await createUser(accountState);
    await assert.rejects(asAdmin(admin.id, () => suspendUserAccount(member.id, 'Reason')));
  });
}

test('suspending a user who currently holds an administrator or Super Admin grant is rejected, so their role authority cannot be silently disabled without going through role revocation', async () => {
  const admin = await adminUser();
  const otherAdmin = await createUser('active');
  await grantRole(otherAdmin.id, 'administrator');

  await assert.rejects(
    asAdmin(admin.id, () => suspendUserAccount(otherAdmin.id, 'Trying to disable a peer admin')),
    /role/,
  );
  const [user] = await sql`select account_state from idoc.users where id=${otherAdmin.id}`;
  assert.equal(user.account_state, 'active');
});

test('a non-administrator actor cannot suspend an account', async () => {
  const notAdmin = await createUser('active');
  const member = await createUser('active');
  await assert.rejects(asAdmin(notAdmin.id, () => suspendUserAccount(member.id, 'Reason')));
});

test('reinstating a suspended account restores the chosen account_state and writes audit and notification, but does not bump session_version', async () => {
  const admin = await adminUser();
  const member = await createUser('suspended');

  await asAdmin(admin.id, () => reinstateUserAccount(member.id, { accountState: 'active', reason: 'Investigation cleared the account' }));

  const [user] = await sql`select account_state, session_version from idoc.users where id=${member.id}`;
  assert.equal(user.account_state, 'active');
  assert.equal(user.session_version, 0);

  const [audit] = await sql`select action, actor_id, reason, before_json, after_json from idoc.audit_log where action='admin.account.reinstated'`;
  assert.equal(audit.actor_id, admin.id);
  assert.equal(audit.reason, 'Investigation cleared the account');
  assert.deepEqual(audit.before_json, { accountState: 'suspended' });
  assert.deepEqual(audit.after_json, { accountState: 'active' });

  const [notification] = await sql`select kind, user_id from idoc.auth_security_notification_outbox where kind='account_reinstated'`;
  assert.equal(notification.user_id, member.id);
});

test('reinstating a non-suspended account to a different state than it currently holds is rejected', async () => {
  const admin = await adminUser();
  const member = await createUser('active');
  await assert.rejects(
    asAdmin(admin.id, () => reinstateUserAccount(member.id, { accountState: 'onboarding', reason: 'Reason' })),
    /not currently suspended/,
  );
});

test('retrying reinstatement to the account\'s already-current state succeeds idempotently: no duplicate audit row, no duplicate notification', async () => {
  const admin = await adminUser();
  const member = await createUser('suspended');
  await asAdmin(admin.id, () => reinstateUserAccount(member.id, { accountState: 'active', reason: 'First attempt' }));

  await asAdmin(admin.id, () => reinstateUserAccount(member.id, { accountState: 'active', reason: 'Retry after a partial failure' }));

  const [user] = await sql`select account_state from idoc.users where id=${member.id}`;
  assert.equal(user.account_state, 'active');
  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where entity_id=${String(member.id)}`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.auth_security_notification_outbox where user_id=${member.id} and kind='account_reinstated'`)[0].count, 1);
});

test('a non-administrator actor cannot reinstate an account', async () => {
  const notAdmin = await createUser('active');
  const member = await createUser('suspended');
  await assert.rejects(asAdmin(notAdmin.id, () => reinstateUserAccount(member.id, { accountState: 'active', reason: 'Reason' })));
});
