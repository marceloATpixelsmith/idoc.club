import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { signIn, updatePassword } from '../app/(login)/actions.ts';
import { completeSignup } from '../app/(login)/sign-up/actions.ts';
import { verifyStepUpTotp } from '../app/(login)/mfa/actions.ts';
import { logOutSession } from '../app/(dashboard)/dashboard/security/actions.ts';
import { markPendingSignupVerified, startPendingSignup } from '../lib/auth/pending-signup.ts';
import { startPendingLogin } from '../lib/auth/pending-login.ts';
import { getPendingStepUp, requireFreshStepUp } from '../lib/auth/mfa/step-up.ts';
import { getPendingPrimaryAuth } from '../lib/auth/mfa/pending-primary-auth.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { beginTotpEnrollment, completeTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import { MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { getSession, hashPassword, sessionCookieName, setSession } from '../lib/auth/session.ts';
import { getUser } from '../lib/db/queries.ts';
import { GOOGLE_OIDC_PROVIDER } from '../lib/auth/google-oidc-reference.ts';
import { linkGoogleIdentity, unlinkGoogleIdentity } from '../lib/auth/google-identity-linking.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { getPrivateMember } from '../lib/membership/data-access.ts';
import { db } from '../lib/db/drizzle.ts';
import { users } from '../lib/db/schema.ts';
import { eq } from 'drizzle-orm';
import { stubPasswordBreachCheckAsClean } from './password-breach-check-stub.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { csrfCookieName } from '../lib/security/csrf-tokens.ts';
import { closeHarness, createProfile, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

const password = 'Correct Horse Battery Staple 42!';
const encryptionKey = randomBytes(32);
const store = new PostgresMfaStore(sql);
const restoreFetch = stubPasswordBreachCheckAsClean();

Object.assign(process.env, {
  AUTH_SECRET: 'authz-privilege-boundary-secret-long-enough',
  BASE_URL: 'http://localhost:3000',
  MFA_PENDING_AUTH_SIGNING_KEY: randomBytes(32).toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: randomBytes(32).toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'authz-privilege',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'authz-privilege': encryptionKey.toString('base64url') }),
  RATE_LIMIT_HASH_KEY: 'authz-privilege-boundary-rate-limit-secret',
  REMEMBER_TOTP_DEVICE_ENABLED: 'false',
});

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

beforeEach(resetIdoc);
after(() => { restoreFetch(); return closeHarness(); });

async function realUser(accountState: 'active' | 'deleted' | 'suspended' = 'active', privileged = false) {
  const fixture = await createUser(accountState);
  await sql`update idoc.users set password_hash=${await hashPassword(password)} where id=${fixture.id}`;
  if (privileged) await grantRole(fixture.id, 'administrator');
  return (await db.select().from(users).where(eq(users.id, fixture.id)).limit(1))[0];
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

async function activeTotpFactor(user: { email: string; id: number }, nowMs = Date.now() - 30_000) {
  const enrollment = await beginTotpEnrollment({ accountLabel: user.email, applicationId: MFA_APPLICATION_ID,
    encryptionKey, issuer: 'IDOC', keyId: 'authz-privilege', nowMs, store, subjectId: String(user.id) });
  const secret = new URL(enrollment.provisioningUri).searchParams.get('secret')!;
  const result = await completeTotpEnrollment({ applicationId: MFA_APPLICATION_ID,
    code: totp(secret, nowMs), factorId: enrollment.factorId, nowMs, resolveKey: () => encryptionKey,
    store, subjectId: String(user.id), transactionId: enrollment.transactionId });
  assert.equal(result.status, 'activated');
  return secret;
}

/** Reads back the CSRF token setSession()/clearSession() already minted into this cookie store as
 * a side effect of establishing/clearing the session, rather than minting a second, separate one. */
function csrfTokenFrom(cookies: TestCookies): string {
  return cookies.get(csrfCookieName())?.value ?? '';
}

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

async function redirected(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => String(error).includes('NEXT_REDIRECT'));
}

/** Grants real fresh step-up authority through the actual production TOTP challenge/verify round
 * trip (requireFreshStepUp -> verifyStepUpTotp), not a manually constructed cookie. */
async function grantRealFreshStepUp(cookies: TestCookies, user: { id: number; sessionVersion: number },
  secret: string, action: 'change-password' = 'change-password') {
  const started = await withTestRequestCookies(cookies, () => requireFreshStepUp(user, action, '/dashboard/security'));
  assert.equal(started.required, true);
  const pending = await withTestRequestCookies(cookies, getPendingStepUp);
  assert.ok(pending);
  await redirected(() => withTestRequestCookies(cookies, () => verifyStepUpTotp({}, form({ code: totp(secret), csrf_token: csrfTokenFrom(cookies) }))));
  assert.ok(cookies.get('idoc_fresh_step_up'));
}

// ---------------------------------------------------------------------------------------------
// AUTH-LIFECYCLE-002: signIn and completeSignup reject disallowed account lifecycle states.
// ---------------------------------------------------------------------------------------------

test('AUTH-LIFECYCLE-002: signIn rejects a suspended account with the same generic error as a wrong password, and no session or MFA continuation is created', async () => {
  const suspended = await realUser('suspended');
  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(suspended.email);
    const result = await signIn({}, form({ csrf_token, email: suspended.email, password }));
    assert.deepEqual(result, { email: suspended.email, error: 'Invalid email or password. Please try again.' });
    assert.equal(cookies.get(sessionCookieName()), undefined);
  });
  assert.equal((await sql`select count(*)::int count from idoc.auth_sessions where user_id=${suspended.id}`)[0].count, 0);
});

test('AUTH-LIFECYCLE-002: signIn rejects a deleted account the same way', async () => {
  const deleted = await realUser('deleted');
  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(deleted.email);
    const result = await signIn({}, form({ csrf_token, email: deleted.email, password }));
    assert.deepEqual(result, { email: deleted.email, error: 'Invalid email or password. Please try again.' });
    assert.equal(cookies.get(sessionCookieName()), undefined);
  });
  assert.equal((await sql`select count(*)::int count from idoc.auth_sessions where user_id=${deleted.id}`)[0].count, 0);
});

test('AUTH-LIFECYCLE-002: signIn still proceeds past the account-state gate for an active account with the identical credential path (positive control)', async () => {
  // A privileged account is used here (rather than an ordinary member) so this positive control
  // exercises only the account-state/credential gate this control is about, without also
  // depending on the separate ordinary-member ordinary-login-device-trust cookie lookup.
  const admin = await realUser('active', true);
  await activeTotpFactor(admin);
  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(admin.email);
    await redirected(() => signIn({}, form({ csrf_token, email: admin.email, password })));
    assert.equal((await getPendingPrimaryAuth())?.stage, 'challenge');
  });
  assert.equal(cookies.get(sessionCookieName()), undefined);
});

test('AUTH-LIFECYCLE-002: completeSignup rejects duplicate registration for an email that already belongs to a suspended account, creating no second user row', async () => {
  const suspended = await realUser('suspended');
  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, async () => {
    await startPendingSignup(suspended.email);
    await markPendingSignupVerified(suspended.email);
    const result = await completeSignup({}, form({ csrf_token, password: 'Another Correct Battery 99!' }));
    assert.deepEqual(result, { error: 'An account with this email already exists. Sign in instead.' });
  });
  assert.equal((await sql`select count(*)::int count from idoc.users where email=${suspended.email}`)[0].count, 1);
});

// ---------------------------------------------------------------------------------------------
// AUTH-PASSWORD-005: updatePassword requires authenticated subject binding, fresh verification,
// and rotates session authority -- exercised against the real production Server Action.
// ---------------------------------------------------------------------------------------------

test('AUTH-PASSWORD-005: an ordinary member (no configured MFA factor) changes password, rotating session authority and queuing evidence', async () => {
  const user = await realUser('active');
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, async () => {
    await setSession(user);
  });

  // A second, independent session for the same account (e.g. a different browser) must be
  // invalidated by the sessionVersion bump even though it never touches this password change.
  const otherDeviceCookies = new TestCookies();
  await withTestRequestCookies(otherDeviceCookies, async () => {
    await setSession(user);
    assert.ok(await getSession());
  });

  const csrf_token = csrfTokenFrom(cookies);
  await withTestRequestCookies(cookies, () => withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, async () => {
    await redirected(() => updatePassword({}, form({
      confirmPassword: 'A New Correct Battery 77!', csrf_token, currentPassword: password, newPassword: 'A New Correct Battery 77!',
    })));
  }));

  const [row] = await sql`select password_hash, session_version from idoc.users where id=${user.id}`;
  assert.notEqual(row.password_hash, user.passwordHash);
  assert.equal(row.session_version, user.sessionVersion + 1);
  assert.equal((await sql`select count(*)::int count from idoc.audit_log where actor_id=${user.id} and action='account.password.changed'`)[0].count, 1);
  assert.equal((await sql`select count(*)::int count from idoc.auth_security_notification_outbox where user_id=${user.id} and kind='password_changed'`)[0].count, 1);

  // The acting browser's own session cookie was cleared by clearSession().
  assert.equal(cookies.get(sessionCookieName()), undefined);

  // The other, untouched browser's session cookie/registry row is still nominally present, but the
  // production authorization boundary (getUser(), used by every validatedActionWithUser action)
  // now rejects it: its JWT still claims the OLD sessionVersion, which no longer matches the live
  // users.session_version row this password change just incremented.
  await withTestRequestCookies(otherDeviceCookies, async () => {
    assert.equal(await getUser(), null);
  });
});

test('AUTH-PASSWORD-005: an incorrect current password is rejected without mutating the credential, session version, or evidence', async () => {
  const user = await realUser('active');
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, () => setSession(user));
  const csrf_token = csrfTokenFrom(cookies);

  const result = await withTestRequestCookies(cookies, () => withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () =>
    updatePassword({}, form({ confirmPassword: 'A New Correct Battery 77!', csrf_token, currentPassword: 'wrong-password-entirely', newPassword: 'A New Correct Battery 77!' }))));
  assert.deepEqual(result, { error: 'Current password is incorrect.' });

  const [row] = await sql`select password_hash, session_version from idoc.users where id=${user.id}`;
  assert.equal(row.password_hash, user.passwordHash);
  assert.equal(row.session_version, user.sessionVersion);
  assert.equal((await sql`select count(*)::int count from idoc.audit_log where actor_id=${user.id}`)[0].count, 0);
  assert.equal((await sql`select count(*)::int count from idoc.auth_security_notification_outbox where user_id=${user.id}`)[0].count, 0);
});

test('AUTH-PASSWORD-005: reusing the current password as the new password is rejected without mutation', async () => {
  const user = await realUser('active');
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, () => setSession(user));
  const csrf_token = csrfTokenFrom(cookies);
  const result = await withTestRequestCookies(cookies, () => withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () =>
    updatePassword({}, form({ confirmPassword: password, csrf_token, currentPassword: password, newPassword: password }))));
  assert.deepEqual(result, { error: 'New password must be different from the current password.' });
  assert.equal((await sql`select session_version from idoc.users where id=${user.id}`)[0].session_version, user.sessionVersion);
});

test('AUTH-PASSWORD-005: a privileged (administrator) account cannot change its password without a fresh TOTP step-up, and no mutation occurs on that attempt', async () => {
  const admin = await realUser('active', true);
  const secret = await activeTotpFactor(admin);
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, () => setSession(admin));

  await withTestRequestCookies(cookies, () => withTestMembershipBoundary({ actor: { id: admin.id, roles: ['administrator'] } }, () =>
    redirected(() => updatePassword({}, form({ confirmPassword: 'A New Correct Battery 77!', csrf_token: csrfTokenFrom(cookies), currentPassword: password, newPassword: 'A New Correct Battery 77!' })))));
  const [beforeStepUp] = await sql`select password_hash, session_version from idoc.users where id=${admin.id}`;
  assert.equal(beforeStepUp.password_hash, admin.passwordHash);
  assert.equal(beforeStepUp.session_version, admin.sessionVersion);

  // Now grant real fresh step-up through the actual TOTP round trip and retry: it succeeds.
  await grantRealFreshStepUp(cookies, admin, secret);
  await withTestRequestCookies(cookies, () => withTestMembershipBoundary({ actor: { id: admin.id, roles: ['administrator'] } }, () =>
    redirected(() => updatePassword({}, form({ confirmPassword: 'A New Correct Battery 77!', csrf_token: csrfTokenFrom(cookies), currentPassword: password, newPassword: 'A New Correct Battery 77!' })))));
  const [afterStepUp] = await sql`select password_hash, session_version from idoc.users where id=${admin.id}`;
  assert.notEqual(afterStepUp.password_hash, admin.passwordHash);
  assert.equal(afterStepUp.session_version, admin.sessionVersion + 1);
});

// ---------------------------------------------------------------------------------------------
// AUTH-IDENTITY-005: collision-safe, atomic external-identity (Google) linking/unlinking.
// ---------------------------------------------------------------------------------------------

function googleIdentity(userId: string, subject: string) {
  return {
    email: `${subject}@example.test`, emailVerified: true, issuer: GOOGLE_OIDC_PROVIDER.issuer,
    name: 'Test Subject', oauthAuthenticatedUserId: userId, oauthTransactionPurpose: 'external_identity_link' as const,
    picture: null, returnTo: '/dashboard/security', subject,
  };
}

function freshEvidence(userId: string, purpose: 'external_identity_link' | 'external_identity_unlink', ageMs = 0) {
  return { method: 'password' as const, purpose, transactionId: `tx-${userId}-${purpose}-${Math.random()}`,
    userId, verifiedAtMs: Date.now() - ageMs };
}

/** Links as the given acting user id, with the freshEvidence bound to that same id by default
 * (the production callback route always issues evidence for the authenticated linking actor). */
function linkAsUser(actingUserId: string, subject: string, options: { evidenceUserId?: string; identityUserId?: string; ageMs?: number } = {}) {
  return linkGoogleIdentity({
    freshEvidence: freshEvidence(options.evidenceUserId ?? actingUserId, 'external_identity_link', options.ageMs),
    identity: googleIdentity(options.identityUserId ?? actingUserId, subject),
    userId: actingUserId,
  });
}

test('AUTH-IDENTITY-005: linking a fresh Google identity persists the link atomically with audit and notification evidence', async () => {
  const user = await realUser('active');
  const result = await linkAsUser(String(user.id), 'subject-fresh-link');
  assert.deepEqual(result, { status: 'linked' });

  const [row] = await sql`select subject from idoc.external_identities where user_id=${user.id} and provider='google'`;
  assert.equal(row.subject, 'subject-fresh-link');
  assert.equal((await sql`select count(*)::int count from idoc.audit_log where actor_id=${user.id} and action='auth.google_identity.linked'`)[0].count, 1);
  assert.equal((await sql`select count(*)::int count from idoc.auth_security_notification_outbox where user_id=${user.id} and kind='google_identity_linked'`)[0].count, 1);
});

test('AUTH-IDENTITY-005: linking a Google identity already claimed by a different account is rejected as a collision, without touching either account\'s row', async () => {
  const owner = await realUser('active');
  const attacker = await realUser('active');
  await linkAsUser(String(owner.id), 'subject-collision');

  const result = await linkAsUser(String(attacker.id), 'subject-collision');
  assert.deepEqual(result, { status: 'collision' });

  const rows = await sql`select user_id from idoc.external_identities where subject='subject-collision'`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, owner.id);
  assert.equal((await sql`select count(*)::int count from idoc.external_identities where user_id=${attacker.id}`)[0].count, 0);
});

test('AUTH-IDENTITY-005: linking a second, different Google identity to an account that already has one linked is rejected, leaving the original link intact', async () => {
  const user = await realUser('active');
  await linkAsUser(String(user.id), 'subject-first');
  const result = await linkAsUser(String(user.id), 'subject-second');
  assert.deepEqual(result, { status: 'different-google-identity-already-linked' });
  const [row] = await sql`select subject from idoc.external_identities where user_id=${user.id}`;
  assert.equal(row.subject, 'subject-first');
});

test('AUTH-IDENTITY-005: re-linking the identical already-owned identity is idempotent (already-linked), not a duplicate row', async () => {
  const user = await realUser('active');
  await linkAsUser(String(user.id), 'subject-repeat');
  const result = await linkAsUser(String(user.id), 'subject-repeat');
  assert.deepEqual(result, { status: 'already-linked' });
  assert.equal((await sql`select count(*)::int count from idoc.external_identities where user_id=${user.id}`)[0].count, 1);
});

test('AUTH-IDENTITY-005: stale fresh-evidence (older than the 5-minute window) is rejected before any database write', async () => {
  const user = await realUser('active');
  await assert.rejects(linkAsUser(String(user.id), 'subject-stale', { ageMs: 6 * 60 * 1000 }));
  assert.equal((await sql`select count(*)::int count from idoc.external_identities`)[0].count, 0);
});

test('AUTH-IDENTITY-005: fresh-evidence bound to a different user id than the actual identity cannot be used to link that other user\'s account', async () => {
  const owner = await realUser('active');
  const bystander = await realUser('active');
  await assert.rejects(linkAsUser(String(owner.id), 'subject-cross-user', { evidenceUserId: String(bystander.id) }));
  assert.equal((await sql`select count(*)::int count from idoc.external_identities`)[0].count, 0);
});

test('AUTH-IDENTITY-005: two different accounts concurrently linking the same Google subject resolve to exactly one winner under the advisory lock', async () => {
  const first = await realUser('active');
  const second = await realUser('active');
  const results = await Promise.allSettled([
    linkAsUser(String(first.id), 'subject-race'),
    linkAsUser(String(second.id), 'subject-race'),
  ]);
  const linked = results.filter((result) => result.status === 'fulfilled' && result.value.status === 'linked');
  const collided = results.filter((result) => result.status === 'fulfilled' && result.value.status === 'collision');
  assert.equal(linked.length, 1, 'exactly one concurrent link must win');
  assert.equal(collided.length, 1, 'the loser must see a collision, never a silent overwrite');
  assert.equal((await sql`select count(*)::int count from idoc.external_identities where subject='subject-race'`)[0].count, 1);
});

test('AUTH-IDENTITY-005: unlinking a connected Google identity removes it atomically with audit and notification evidence', async () => {
  const user = await realUser('active');
  await linkAsUser(String(user.id), 'subject-to-unlink');
  const result = await unlinkGoogleIdentity({ freshEvidence: freshEvidence(String(user.id), 'external_identity_unlink'), userId: String(user.id) });
  assert.deepEqual(result, { status: 'unlinked' });
  assert.equal((await sql`select count(*)::int count from idoc.external_identities where user_id=${user.id}`)[0].count, 0);
  assert.equal((await sql`select count(*)::int count from idoc.audit_log where actor_id=${user.id} and action='auth.google_identity.unlinked'`)[0].count, 1);
  assert.equal((await sql`select count(*)::int count from idoc.auth_security_notification_outbox where user_id=${user.id} and kind='google_identity_unlinked'`)[0].count, 1);
});

test('AUTH-IDENTITY-005: unlinking an account with no connected Google identity is a neutral no-op, not an error', async () => {
  const user = await realUser('active');
  const result = await unlinkGoogleIdentity({ freshEvidence: freshEvidence(String(user.id), 'external_identity_unlink'), userId: String(user.id) });
  assert.deepEqual(result, { status: 'not-linked' });
});

// ---------------------------------------------------------------------------------------------
// AUTH-STORAGE-002: representative production write boundaries are authorized and purpose-bound.
// role-grants.integration.ts (grantApplicationRole/revokeApplicationRole) and
// authorization-matrix.integration.ts (updateMemberProfile) each already prove this property for
// their own write boundary; this test proves it again for the session-registry write boundary
// through the real production Server Action, closing the property across three independent
// modules rather than leaving it as an inferred, unexercised architectural claim.
// ---------------------------------------------------------------------------------------------

test('AUTH-STORAGE-002: logOutSession revokes only a session the authenticated caller actually owns, using the server-derived actor id as the write\'s authorization boundary', async () => {
  const owner = await realUser('active');
  const bystander = await realUser('active');

  const ownerCookies = new TestCookies();
  const ownerSessionId = await withTestRequestCookies(ownerCookies, async () => {
    await setSession(owner);
    return (await getSession())!.sessionId;
  });
  // A second session for the owner is the actual logout target (logOutSession refuses to log out
  // the browser's own current session -- see actions.ts -- so a distinct target session is needed).
  const targetCookies = new TestCookies();
  const targetSessionId = await withTestRequestCookies(targetCookies, async () => {
    await setSession(owner);
    return (await getSession())!.sessionId;
  });

  const bystanderCookies = new TestCookies();
  const bystanderSessionId = await withTestRequestCookies(bystanderCookies, async () => {
    await setSession(bystander);
    return (await getSession())!.sessionId;
  });

  // Adversarial: the owner's authenticated action cannot revoke the bystander's session id, even
  // though it is a syntactically valid session id the caller can simply supply as form input.
  const ownerCsrfToken = csrfTokenFrom(ownerCookies);
  await withTestRequestCookies(ownerCookies, () => withTestMembershipBoundary({ actor: { id: owner.id, roles: [] } }, () =>
    logOutSession({}, form({ csrf_token: ownerCsrfToken, sessionId: bystanderSessionId }))));
  assert.equal((await sql`select revoked_at from idoc.auth_sessions where session_id=${bystanderSessionId}`)[0].revoked_at, null);
  const auditCountBeforeSuccess = (await sql`select count(*)::int count from idoc.audit_log where actor_id=${owner.id} and action='security.session.logged_out'`)[0].count;

  // Positive: the same action, given a session id the caller actually owns, succeeds.
  const result = await withTestRequestCookies(ownerCookies, () => withTestMembershipBoundary({ actor: { id: owner.id, roles: [] } }, () =>
    logOutSession({}, form({ csrf_token: ownerCsrfToken, sessionId: targetSessionId }))));
  assert.deepEqual(result, { success: 'That session has been logged out.' });
  assert.ok((await sql`select revoked_at from idoc.auth_sessions where session_id=${targetSessionId}`)[0].revoked_at);
  const auditCountAfterSuccess = (await sql`select count(*)::int count from idoc.audit_log where actor_id=${owner.id} and action='security.session.logged_out'`)[0].count;
  assert.equal(auditCountAfterSuccess - auditCountBeforeSuccess, 1, 'the successful, owned revocation must add exactly one audit row');

  // The owner's own current session and the bystander's session remain completely unaffected.
  assert.equal((await sql`select revoked_at from idoc.auth_sessions where session_id=${ownerSessionId}`)[0].revoked_at, null);
  assert.equal((await sql`select revoked_at from idoc.auth_sessions where session_id=${bystanderSessionId}`)[0].revoked_at, null);
});

// ---------------------------------------------------------------------------------------------
// AUTH-API-004 (continued): the production `getPrivateMember` boundary itself, which docs/22
// also cites for this control alongside /api/user. tests/security-e2e/api-authorization-
// disclosure.spec.ts proves the /api/user HTTP pattern end-to-end; this proves the actual
// getPrivateMember function's behavior directly against real Postgres, since no non-administrator
// caller of it is reachable through any HTTP route in this application today (grep-confirmed: the
// only production callers with a client-suppliable profile id, app/(dashboard)/admin/members/
// page.tsx and app/(dashboard)/admin/payments/page.tsx, both call requireAdministrator() first and
// unconditionally, so getPrivateMember's own requireOwnerOrAdmin check can never actually reject
// there -- the caller is always already authorized for every profile by the time it runs).
// ---------------------------------------------------------------------------------------------

test('AUTH-API-004: getPrivateMember distinguishes a nonexistent profile (null, no throw) from an existing-but-cross-account profile (AuthorizationError) for a genuine non-owner, non-admin actor', async () => {
  const owner = await realUser('active');
  const profile = await createProfile(owner.id);
  const attacker = await realUser('active');

  const nonexistentProfileId = profile.id + 1_000_000;
  const nonexistentResult = await withTestMembershipBoundary({ actor: { id: attacker.id, roles: [] } }, () => getPrivateMember(nonexistentProfileId));
  assert.equal(nonexistentResult, null);

  await assert.rejects(
    withTestMembershipBoundary({ actor: { id: attacker.id, roles: [] } }, () => getPrivateMember(profile.id)),
    (error: unknown) => error instanceof Error && error.name === 'AuthorizationError',
  );

  // The owner and an administrator can each read the real profile without error (positive control
  // confirming the rejection above is genuinely about ownership, not a broken fixture).
  const ownRead = await withTestMembershipBoundary({ actor: { id: owner.id, roles: [] } }, () => getPrivateMember(profile.id));
  assert.equal(ownRead?.profile.id, profile.id);
  const admin = await realUser('active', true);
  const adminRead = await withTestMembershipBoundary({ actor: { id: admin.id, roles: [] } }, () => getPrivateMember(profile.id));
  assert.equal(adminRead?.profile.id, profile.id);
});
