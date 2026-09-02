import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { forceRevokeAllAuthorityForm } from '../app/(dashboard)/admin/members/actions.ts';
import { forceRevokeAllAuthority } from '../lib/membership/incident-response.ts';
import { MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { verifyStepUpTotp } from '../app/(login)/mfa/actions.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { beginTotpEnrollment, completeTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { setSession } from '../lib/auth/session.ts';
import { csrfCookieName } from '../lib/security/csrf-tokens.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';

// AUTH-OPERATIONS-007: an operator-initiated "force-revoke all authority for user X" incident-response
// action. Drives the real production forceRevokeAllAuthority function -- not a parallel helper --
// proving it actually revokes every live session, remembered/trusted device, and MFA factor for the
// target user, bumps their sessionVersion, records an incident-correlated audit entry, and notifies
// the account owner, while enforcing the Super-Admin-only, not-against-yourself authorization boundary.
// A Codex review on this pull request caught that the initial version of forceRevokeAllAuthorityForm
// had no fresh-step-up gate at all (unlike the neighboring role grant/revoke actions) -- an
// authenticated Super Admin session and its CSRF token alone were sufficient to reach it. The tests at
// the bottom of this file drive the real forceRevokeAllAuthorityForm Server Action (not the bare
// library function) end to end and prove that gate is now real: a call with no fresh step-up redirects
// to /mfa and revokes nothing, and only a call made after a genuine fresh TOTP step-up proceeds.

const stepUpEncryptionKey = randomBytes(32);
const stepUpContinuationKey = randomBytes(32);
const stepUpStore = new PostgresMfaStore(sql);

Object.assign(process.env, {
  AUTH_SECRET: 'incident-response-test-auth-secret-long-enough',
  BASE_URL: 'http://localhost:3000',
  MFA_PENDING_AUTH_SIGNING_KEY: stepUpContinuationKey.toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: randomBytes(32).toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'incident-response-test',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'incident-response-test': stepUpEncryptionKey.toString('base64url') }),
});
process.env.RATE_LIMIT_HASH_KEY ??= 'incident-response-test-rate-limit-secret';

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

function totp(secret: string, nowMs = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(Math.floor(nowMs / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = digest.at(-1)! & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

beforeEach(resetIdoc);
after(closeHarness);

async function superAdmin() {
  const user = await createUser();
  await grantRole(user.id, 'super_admin');
  return user;
}

async function dbUser(id: number) {
  const [row] = await sql<Record<string, unknown>[]>`select * from idoc.users where id=${id}`;
  assert.ok(row);
  return {
    ...row,
    accountState: row.account_state,
    deletedAt: row.deleted_at,
    emailVerifiedAt: row.email_verified_at,
    passwordHash: row.password_hash,
    sessionVersion: Number(row.session_version),
  } as any;
}

async function superAdminWithTotp() {
  const created = await superAdmin();
  const user = await dbUser(created.id);
  const enrolledAt = Date.now() - 30_000;
  const enrollment = await beginTotpEnrollment({
    accountLabel: user.email, applicationId: MFA_APPLICATION_ID, encryptionKey: stepUpEncryptionKey,
    issuer: 'IDOC', keyId: 'incident-response-test', nowMs: enrolledAt, store: stepUpStore, subjectId: String(user.id),
  });
  const secret = new URL(enrollment.provisioningUri).searchParams.get('secret')!;
  const completed = await completeTotpEnrollment({
    applicationId: MFA_APPLICATION_ID, code: totp(secret, enrolledAt), factorId: enrollment.factorId, nowMs: enrolledAt,
    resolveKey: () => stepUpEncryptionKey, store: stepUpStore, subjectId: String(user.id), transactionId: enrollment.transactionId,
  });
  assert.equal(completed.status, 'activated');
  return { secret, user };
}

function revokeForm(userId: number, csrfToken: string) {
  const data = new FormData();
  data.set('userId', String(userId));
  data.set('incidentReference', 'INC-2026-STEPUP');
  data.set('reason', 'step-up boundary test');
  data.set('csrf_token', csrfToken);
  return data;
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

test('the real Server Action redirects to /mfa and revokes nothing without a fresh step-up', async () => {
  const { user: admin } = await superAdminWithTotp();
  const victim = await createUser();
  const seeded = await seedStandingAuthority(victim.id);
  const cookies = new TestCookies();

  await withTestRequestCookies(cookies, () => setSession(admin));
  const csrfToken = cookies.get(csrfCookieName())?.value ?? '';
  assert.ok(csrfToken);

  await withTestRequestCookies(cookies, () => forceRevokeAllAuthorityForm({}, revokeForm(victim.id, csrfToken)))
    .then(() => assert.fail('a call with no fresh step-up must redirect to /mfa'),
      (error) => assert.match(String((error as { digest?: string }).digest), /NEXT_REDIRECT;replace;\/mfa;/));

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user.session_version, 0, 'no step-up authority yet -- nothing about the target may change');
  const [factor] = await sql<{ status: string }[]>`select status from idoc.mfa_factors where factor_id=${seeded.factorId}`;
  assert.equal(factor.status, 'active');
});

test('the real Server Action proceeds only after a genuine fresh TOTP step-up round', async () => {
  const { secret, user: admin } = await superAdminWithTotp();
  const victim = await createUser();
  const seeded = await seedStandingAuthority(victim.id);
  const cookies = new TestCookies();

  await withTestRequestCookies(cookies, () => setSession(admin));
  const csrfToken = cookies.get(csrfCookieName())?.value ?? '';

  // First call has no fresh step-up: it both redirects to /mfa and -- as the real production flow
  // does -- creates the pending step-up challenge this same request just triggered.
  await withTestRequestCookies(cookies, () => forceRevokeAllAuthorityForm({}, revokeForm(victim.id, csrfToken)))
    .then(() => assert.fail('expected a redirect to /mfa'), (error) => assert.match(String(error), /NEXT_REDIRECT/));

  // Complete that real step-up challenge with a genuine TOTP code, exactly as the /mfa page would.
  await withTestRequestCookies(cookies, async () => {
    const code = totp(secret);
    const form = new FormData(); form.set('code', code); form.set('csrf_token', csrfToken);
    await verifyStepUpTotp({}, form).then(
      () => assert.fail('successful step-up verification should redirect'),
      (error) => assert.match(String(error), /NEXT_REDIRECT/),
    );
  });
  assert.ok(cookies.get('idoc_fresh_step_up'), 'fresh step-up authority must now be present');

  // Retried with fresh authority in hand, the same action now actually performs the revocation.
  const result = await withTestRequestCookies(cookies, () => forceRevokeAllAuthorityForm({}, revokeForm(victim.id, csrfToken)));
  assert.deepEqual(result, { success: 'Every session, remembered device, and MFA factor for this user has been revoked.' });

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user.session_version, 1);
  const [factor] = await sql<{ status: string }[]>`select status from idoc.mfa_factors where factor_id=${seeded.factorId}`;
  assert.equal(factor.status, 'revoked');
});
