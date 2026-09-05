import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { forceRevokeAllAuthorityForm } from '../app/(dashboard)/admin/members/actions.ts';
import { forceRevokeAllAuthority } from '../lib/membership/incident-response.ts';
import { MFA_APPLICATION_ID, beginPrimaryMfa } from '../lib/auth/mfa/login.ts';
import { verifyLoginTotp, verifyStepUpTotp } from '../app/(login)/mfa/actions.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { beginTotpEnrollment, completeTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { setSession } from '../lib/auth/session.ts';
import { csrfCookieName } from '../lib/security/csrf-tokens.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';

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

async function privilegedUserWithTotp(role: 'administrator' | 'super_admin' = 'super_admin') {
  const created = await createUser();
  await grantRole(created.id, role);
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

async function superAdminWithTotp() {
  return privilegedUserWithTotp('super_admin');
}

function revokeForm(userId: number, csrfToken: string) {
  const data = new FormData();
  data.set('userId', String(userId));
  data.set('incidentReference', 'INC-2026-STEPUP');
  data.set('reason', 'step-up boundary test');
  data.set('csrf_token', csrfToken);
  return data;
}

function loginTotpForm(code: string, csrfToken: string) {
  const data = new FormData();
  data.set('code', code);
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

  const [opsAlert] = await sql<{ kind: string; subject: string; body_html: string; sent_at: Date | null }[]>`
    select kind,subject,body_html,sent_at from idoc.operational_alert_outbox where kind='incident_response_action_taken'`;
  assert.ok(opsAlert, 'the operations team must also be durably alerted, not only the account owner');
  assert.match(opsAlert.subject, /\[HIGH\]/);
  assert.match(opsAlert.subject, new RegExp(`#${victim.id}\\b`));
  assert.match(opsAlert.body_html, /INC-2026-0042/);
  assert.equal(opsAlert.sent_at, null, 'delivery is the leased worker\'s job, never inline with the request');
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

test('a second run with the same incidentReference is truly idempotent: no second session-version bump, no second notification', async () => {
  const admin = await superAdmin();
  const victim = await createUser();
  await seedStandingAuthority(victim.id);

  const run = () => withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => forceRevokeAllAuthority(victim.id,
    { incidentReference: 'INC-2026-0099', reason: 'incident response' }));
  await run();
  await run();
  await run();

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user.session_version, 1, 'a retried call with the same incidentReference must never re-bump sessionVersion');

  const [{ count: auditCount }] = await sql<{ count: number }[]>`
    select count(*)::int count from idoc.audit_log
    where entity_id=${String(victim.id)} and action='admin.account.authority_force_revoked'`;
  assert.equal(auditCount, 1, 'the idempotency-guaranteeing partial unique index must have prevented a duplicate audit row');

  const [{ count: userNotificationCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_security_notification_outbox where user_id=${victim.id}`;
  assert.equal(userNotificationCount, 1, 'a retried call must never send the account owner a second notification');

  const [{ count: opsAlertCount }] = await sql<{ count: number }[]>`
    select count(*)::int count from idoc.operational_alert_outbox where kind='incident_response_action_taken'`;
  assert.equal(opsAlertCount, 1, 'a retried call must never enqueue a second operations-team alert');
});

test('a different incidentReference for the same account is a distinct, independently-recorded incident, not suppressed by the first', async () => {
  const admin = await superAdmin();
  const victim = await createUser();
  await seedStandingAuthority(victim.id);

  const run = (incidentReference: string) => withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => forceRevokeAllAuthority(victim.id,
    { incidentReference, reason: 'incident response' }));
  await run('INC-2026-A');
  await run('INC-2026-B');

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user.session_version, 2, 'a genuinely distinct incident is a real second state transition, not a duplicate');
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int count from idoc.audit_log
    where entity_id=${String(victim.id)} and action='admin.account.authority_force_revoked'`;
  assert.equal(count, 2);
});

test('concurrent calls with the same incidentReference race safely: exactly one state transition, the loser completes idempotently rather than erroring', async () => {
  const admin = await superAdmin();
  const victim = await createUser();
  await seedStandingAuthority(victim.id);

  const run = () => withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => forceRevokeAllAuthority(victim.id,
    { incidentReference: 'INC-2026-RACE', reason: 'concurrent incident response' }));
  // Two genuinely concurrent database connections/transactions attempting the identical
  // (userId, incidentReference) pair -- proving audit_log_force_revoke_incident_unique (not just the
  // in-process pre-check, which cannot see a concurrent transaction that hasn't committed yet) is
  // what actually decides the race, exactly like the established users_email_unique pattern.
  const results = await Promise.allSettled([run(), run()]);
  for (const result of results) assert.equal(result.status, 'fulfilled', 'the loser of the race must complete idempotently, not throw');

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user.session_version, 1, 'only one of the two racing transactions may actually bump sessionVersion');
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int count from idoc.audit_log
    where entity_id=${String(victim.id)} and action='admin.account.authority_force_revoked'`;
  assert.equal(count, 1);
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

test('a genuine fresh TOTP step-up round applies the original request itself -- no second submission required', async () => {
  // Real production report: every one of these step-up-gated actions previously only redirected
  // back to the originating page once a fresh code was accepted, leaving the actual request
  // (revoke this user's authority, grant this role, ...) unapplied until the member submitted the
  // exact same form a second time. requireFreshStepUp's resume payload now lets the step-up
  // verification handler replay that original request itself the instant the code is accepted.
  const { secret, user: admin } = await superAdminWithTotp();
  const victim = await createUser();
  const seeded = await seedStandingAuthority(victim.id);
  const cookies = new TestCookies();

  await withTestRequestCookies(cookies, () => setSession(admin));
  const csrfToken = cookies.get(csrfCookieName())?.value ?? '';

  // First call has no fresh step-up: it both redirects to /mfa and -- as the real production flow
  // does -- creates the pending step-up challenge this same request just triggered, carrying this
  // exact request's own userId/incidentReference/reason forward as its resume payload.
  await withTestRequestCookies(cookies, () => forceRevokeAllAuthorityForm({}, revokeForm(victim.id, csrfToken)))
    .then(() => assert.fail('expected a redirect to /mfa'), (error) => assert.match(String(error), /NEXT_REDIRECT/));

  const [user0] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user0.session_version, 0, 'no step-up authority yet -- nothing about the target may change');

  // Complete that real step-up challenge with a genuine TOTP code, exactly as the /mfa page would --
  // no second call to forceRevokeAllAuthorityForm anywhere in this test.
  await withTestRequestCookies(cookies, async () => {
    const code = totp(secret);
    const form = new FormData(); form.set('code', code); form.set('csrf_token', csrfToken);
    await verifyStepUpTotp({}, form).then(
      () => assert.fail('successful step-up verification should redirect'),
      (error) => assert.match(String((error as { digest?: string }).digest), /NEXT_REDIRECT;replace;\/admin\/members\?stepUpApplied=1;/),
    );
  });

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user.session_version, 1, 'the revocation must already be applied, purely from accepting the code');
  const [factor] = await sql<{ status: string }[]>`select status from idoc.mfa_factors where factor_id=${seeded.factorId}`;
  assert.equal(factor.status, 'revoked');
});

test('a pending login MFA challenge captured before force-revocation cannot be completed afterward', async () => {
  const actingAdmin = await superAdmin();
  const { secret, user: victim } = await privilegedUserWithTotp('administrator');
  const cookies = new TestCookies();
  const csrfToken = await issueTestCsrfToken(cookies, null);

  // The victim is genuinely mid-login: password already verified, TOTP challenge pending -- this is
  // the real production beginPrimaryMfa function (the same one app/(login)/actions.ts calls right
  // after password verification), not a parallel helper. The pending-primary-auth cookie it issues
  // captures the victim's sessionVersion at this exact moment (0).
  await withTestRequestCookies(cookies, async () => {
    assert.equal(await beginPrimaryMfa(victim, 'password', '/dashboard'), true);
  });
  const code = totp(secret);

  // While that challenge is still outstanding -- an attacker holding a stolen password, mid-TOTP
  // prompt -- a Super Admin notices and force-revokes the victim's authority, which bumps
  // sessionVersion.
  await withTestMembershipBoundary({ actor: { id: actingAdmin.id, roles: [] } }, () => forceRevokeAllAuthority(victim.id,
    { incidentReference: 'INC-2026-MIDLOGIN', reason: 'compromised mid-authentication' }));

  // The attacker, still holding the pending-primary-auth cookie issued before the revocation,
  // submits the correct TOTP code. pendingAccount() (app/(login)/mfa/actions.ts) re-reads the *live*
  // sessionVersion on every use -- it no longer matches what the cookie captured, so this real
  // production verifyLoginTotp Server Action must reject it exactly like any other expired session,
  // never grant a session.
  const result = await withTestRequestCookies(cookies, () => verifyLoginTotp({}, loginTotpForm(code, csrfToken)));
  assert.deepEqual(result, { error: 'Your verification session expired. Sign in again.' },
    'force-revocation must invalidate every pending MFA challenge issued before it, not only completed sessions');

  const [row] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(row.session_version, 1, 'the rejected replay attempt must not itself have mutated anything');
});

test('forceRevokeAllAuthority retried after simulated partial completion finishes the missed steps without re-mutating already-mutated state', async () => {
  const admin = await superAdmin();
  const victim = await createUser();
  const seeded = await seedStandingAuthority(victim.id);

  await withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => forceRevokeAllAuthority(victim.id,
    { incidentReference: 'INC-2026-PARTIAL', reason: 'simulated partial failure recovery' }));

  // Simulate a crash between the transaction committing and the post-transaction cleanup steps
  // completing, by hand-reverting one of those naturally-idempotent side effects the transaction
  // itself does not control (the operations-team alert had not yet been enqueued in the real crash
  // scenario this models).
  await sql`delete from idoc.operational_alert_outbox where kind='incident_response_action_taken'`;

  await withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => forceRevokeAllAuthority(victim.id,
    { incidentReference: 'INC-2026-PARTIAL', reason: 'simulated partial failure recovery' }));

  const [user] = await sql<{ session_version: number }[]>`select session_version::int from idoc.users where id=${victim.id}`;
  assert.equal(user.session_version, 1, 'the retry must not re-run the already-completed state transition');
  const [{ count: auditCount }] = await sql<{ count: number }[]>`
    select count(*)::int count from idoc.audit_log
    where entity_id=${String(victim.id)} and action='admin.account.authority_force_revoked'`;
  assert.equal(auditCount, 1);
  const [{ count: opsAlertCount }] = await sql<{ count: number }[]>`
    select count(*)::int count from idoc.operational_alert_outbox where kind='incident_response_action_taken'`;
  assert.equal(opsAlertCount, 1, 'the retry must complete the missed operations alert the simulated crash dropped');
  const [factor] = await sql<{ status: string }[]>`select status from idoc.mfa_factors where factor_id=${seeded.factorId}`;
  assert.equal(factor.status, 'revoked');
});
