import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { forceRevokeAllAuthority } from '../lib/membership/incident-response.ts';
import { MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';

// AUTH-OPERATIONS-007: an operator-initiated "force-revoke all authority for user X" incident-response
// action. Drives the real production forceRevokeAllAuthority function -- not a parallel helper --
// proving it actually revokes every live session, remembered/trusted device, and MFA factor for the
// target user, bumps their sessionVersion, records an incident-correlated audit entry, and notifies
// the account owner, while enforcing the Super-Admin-only, not-against-yourself authorization boundary.

process.env.RATE_LIMIT_HASH_KEY ??= 'incident-response-test-rate-limit-secret';

beforeEach(resetIdoc);
after(closeHarness);

async function superAdmin() {
  const user = await createUser();
  await grantRole(user.id, 'super_admin');
  return user;
}

async function seedStandingAuthority(userId: number) {
  const sessionId = randomUUID();
  await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
    values(${sessionId},${userId},0,now(),now(),now()+interval '30 days')`;
  const trustedDeviceId = randomUUID();
  await sql`insert into idoc.login_trusted_devices(trusted_device_id,user_id,application_id,token_digest,session_version_at_issue,issued_at,expires_at)
    values(${trustedDeviceId},${userId},${MFA_APPLICATION_ID},${randomUUID()},0,now(),now()+interval '30 days')`;
  const factorId = randomUUID();
  await sql`insert into idoc.mfa_factors(factor_id,user_id,application_id,factor_type,status,encrypted_secret,encryption_key_id)
    values(${factorId},${userId},${MFA_APPLICATION_ID},'totp','active','encrypted-secret','v1')`;
  return { factorId, sessionId, trustedDeviceId };
}

test('a Super Admin force-revoking a compromised account cuts every session, trusted device, and MFA factor, bumps session version, and records an incident-correlated audit entry', async () => {
  const admin = await superAdmin();
  const victim = await createUser();
  const seeded = await seedStandingAuthority(victim.id);

  await withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => forceRevokeAllAuthority(victim.id,
    { incidentReference: 'INC-2026-0042', reason: 'Stolen laptop reported by the member.' }));

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user.session_version, 1);

  const [session] = await sql<{ revoked_at: Date | null; revoke_reason: string | null }[]>`
    select revoked_at,revoke_reason from idoc.auth_sessions where session_id=${seeded.sessionId}`;
  assert.ok(session.revoked_at);

  const [device] = await sql<{ revoked_at: Date | null }[]>`
    select revoked_at from idoc.login_trusted_devices where trusted_device_id=${seeded.trustedDeviceId}`;
  assert.ok(device.revoked_at);

  const [factor] = await sql<{ status: string; lifecycle_reason: string | null }[]>`
    select status,lifecycle_reason from idoc.mfa_factors where factor_id=${seeded.factorId}`;
  assert.equal(factor.status, 'revoked');
  assert.match(factor.lifecycle_reason ?? '', /INC-2026-0042/);

  const [audit] = await sql<{ action: string; actor_id: number; entity_id: string; reason: string; after_json: unknown }[]>`
    select action,actor_id,entity_id,reason,after_json from idoc.audit_log where entity_id=${String(victim.id)} and action='admin.account.authority_force_revoked'`;
  assert.ok(audit);
  assert.equal(audit.actor_id, admin.id);
  assert.equal(audit.reason, 'Stolen laptop reported by the member.');
  assert.deepEqual(audit.after_json, { incidentReference: 'INC-2026-0042' });

  const [notification] = await sql<{ kind: string; recipient_email: string }[]>`
    select kind,recipient_email from idoc.auth_security_notification_outbox where user_id=${victim.id}`;
  assert.equal(notification.kind, 'authority_force_revoked');
  assert.equal(notification.recipient_email, victim.email);
});

test('an ordinary Administrator (not Super Admin) cannot force-revoke authority', async () => {
  const admin = await createUser();
  await grantRole(admin.id, 'administrator');
  const victim = await createUser();
  await seedStandingAuthority(victim.id);

  await assert.rejects(
    withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => forceRevokeAllAuthority(victim.id,
      { incidentReference: 'INC-1', reason: 'not authorized' })),
    /not authorized/,
  );

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user.session_version, 0, 'an unauthorized attempt must not mutate anything');
});

test('a Super Admin cannot use this tool against their own account', async () => {
  const admin = await superAdmin();
  await seedStandingAuthority(admin.id);

  await assert.rejects(
    withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => forceRevokeAllAuthority(admin.id,
      { incidentReference: 'INC-2', reason: 'self-target attempt' })),
    /own account-security tools/,
  );

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${admin.id}`;
  assert.equal(user.session_version, 0);
});

test('a second run for an already-revoked account is idempotent rather than erroring', async () => {
  const admin = await superAdmin();
  const victim = await createUser();
  await seedStandingAuthority(victim.id);

  const run = () => withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => forceRevokeAllAuthority(victim.id,
    { incidentReference: 'INC-2026-0099', reason: 'incident response' }));
  await run();
  await run();

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user.session_version, 2, 'each explicit invocation still bumps the version, matching suspendUserAccount-style semantics');
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_security_notification_outbox where user_id=${victim.id}`;
  assert.equal(count, 2, 'each distinct revocation timestamp is its own dedupe key, matching account-suspension notification semantics');
});
