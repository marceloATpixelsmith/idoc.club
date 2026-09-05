import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { and, eq, isNull } from 'drizzle-orm';
import { completePasswordReset, verifyPasswordResetOtp } from '../app/(login)/recover-password/actions.ts';
import { getPendingPasswordReset, startPendingPasswordReset } from '../lib/auth/pending-password-reset.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { sessionCookieName, setSession } from '../lib/auth/session.ts';
import { beginTotpEnrollment, completeTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import { MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { db } from '../lib/db/drizzle.ts';
import { authSessions, users } from '../lib/db/schema.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

// docs/07 §15.5's UAT contract for password reset/recovery is broader than a bare happy-path
// completion: wrong/expired codes must fail, a privileged account must go through TOTP with no
// email-OTP fallback, and completion must revoke every existing session, never auto-create a new
// one, and enqueue a security notification. A Codex review on the PR that first marked this
// release-readiness item verified (only against a manual happy-path retest) correctly flagged that
// gap -- these tests close it by driving the real production Server Actions against real Postgres.

const encryptionKey = randomBytes(32);
const store = new PostgresMfaStore(sql);

Object.assign(process.env, {
  AUTH_SECRET: 'password-reset-adversarial-secret-long-enough',
  BASE_URL: 'http://localhost:3000',
  MFA_PENDING_AUTH_SIGNING_KEY: randomBytes(32).toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: randomBytes(32).toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'password-reset-test',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'password-reset-test': encryptionKey.toString('base64url') }),
  RATE_LIMIT_HASH_KEY: 'password-reset-adversarial-rate-limit-secret-long-enough',
});

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

beforeEach(resetIdoc);
after(closeHarness);

async function redirected(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => String(error).includes('NEXT_REDIRECT'));
}

function form(fields: Record<string, string>, csrfToken: string): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  data.set('csrf_token', csrfToken);
  return data;
}

async function insertResetOtp(userId: number, email: string, code: string) {
  await sql`insert into idoc.email_otp_codes(user_id,email,purpose,code_hash,expires_at)
    values(${userId},${email},'password_reset',${createHash('sha256').update(code).digest('hex')},now()+interval '10 minutes')`;
}

function generateTotpCode(secret: string, nowMs = Date.now()) {
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

async function activeTotpFactor(user: { email: string; id: number }) {
  const nowMs = Date.now() - 30_000;
  const enrollment = await beginTotpEnrollment({ accountLabel: user.email, applicationId: MFA_APPLICATION_ID,
    encryptionKey, issuer: 'IDOC', keyId: 'password-reset-test', nowMs, store, subjectId: String(user.id) });
  const secret = new URL(enrollment.provisioningUri).searchParams.get('secret')!;
  const result = await completeTotpEnrollment({ applicationId: MFA_APPLICATION_ID,
    code: generateTotpCode(secret, nowMs), factorId: enrollment.factorId, nowMs,
    resolveKey: () => encryptionKey, store, subjectId: String(user.id), transactionId: enrollment.transactionId });
  assert.equal(result.status, 'activated');
  return secret;
}

test('AUTH-RECOVERY: an ordinary member wrong reset code is rejected, and a correct one authorizes the reset', async () => {
  const user = await createUser();
  const cookies = new TestCookies();
  const csrfToken = await issueTestCsrfToken(cookies, null);
  const code = '482913';
  await insertResetOtp(user.id, user.email, code);
  await withTestRequestCookies(cookies, () => startPendingPasswordReset({ email: user.email, stage: 'email-otp', subjectId: user.id }));

  await withTestRequestCookies(cookies, async () => {
    const wrong = await verifyPasswordResetOtp({}, form({ code: '000000' }, csrfToken));
    assert.deepEqual(wrong, { error: 'That verification code is incorrect or expired.' });
  });
  const stillPending = await withTestRequestCookies(cookies, getPendingPasswordReset);
  assert.equal(stillPending?.stage, 'email-otp');

  await withTestRequestCookies(cookies, () => redirected(() =>
    verifyPasswordResetOtp({}, form({ code }, csrfToken))));
  const authorized = await withTestRequestCookies(cookies, getPendingPasswordReset);
  assert.equal(authorized?.stage, 'authorized');
  assert.equal((authorized as { verification?: string })?.verification, 'email-otp');
});

test('AUTH-RECOVERY: a privileged account resets via TOTP only -- a wrong code is rejected neutrally, and a correct one authorizes the reset', async () => {
  const admin = await createUser();
  await grantRole(admin.id, 'administrator');
  const secret = await activeTotpFactor(admin);
  const transactionId = randomUUID();
  await store.createChallenge({ applicationId: MFA_APPLICATION_ID, expiresAtMs: Date.now() + 10 * 60 * 1000,
    maxAttempts: 5, nowMs: Date.now(), purpose: 'password-reset', subjectId: String(admin.id), transactionId });
  const cookies = new TestCookies();
  const csrfToken = await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, () =>
    startPendingPasswordReset({ email: admin.email, stage: 'totp', subjectId: admin.id, transactionId }));

  await withTestRequestCookies(cookies, async () => {
    // Same neutral message as every other unresolved state -- never a distinct "wrong TOTP code"
    // response that would leak that this account exists, is privileged, and uses TOTP.
    const wrong = await verifyPasswordResetOtp({}, form({ code: '000000' }, csrfToken));
    assert.deepEqual(wrong, { error: 'That verification code is incorrect or expired.' });
  });
  const stillPending = await withTestRequestCookies(cookies, getPendingPasswordReset);
  assert.equal(stillPending?.stage, 'totp');

  await withTestRequestCookies(cookies, () => redirected(() =>
    verifyPasswordResetOtp({}, form({ code: generateTotpCode(secret) }, csrfToken))));
  const authorized = await withTestRequestCookies(cookies, getPendingPasswordReset);
  assert.equal(authorized?.stage, 'authorized');
  assert.equal((authorized as { verification?: string })?.verification, 'totp');
});

test('AUTH-RECOVERY: completing a reset revokes every existing session, creates no new one, and enqueues a security notification', async () => {
  const user = await createUser();
  const cookies = new TestCookies();
  const csrfToken = await issueTestCsrfToken(cookies, null);
  const code = '317042';
  await insertResetOtp(user.id, user.email, code);
  await withTestRequestCookies(cookies, () => startPendingPasswordReset({ email: user.email, stage: 'email-otp', subjectId: user.id }));
  await withTestRequestCookies(cookies, () => redirected(() => verifyPasswordResetOtp({}, form({ code }, csrfToken))));

  // A real prior session, exactly like a browser this member was already signed in on elsewhere.
  const [fullUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const priorSessionCookies = new TestCookies();
  await withTestRequestCookies(priorSessionCookies, () => setSession(fullUser));
  assert.ok(priorSessionCookies.get(sessionCookieName()));
  assert.equal((await sql`select count(*)::int count from idoc.auth_sessions where user_id=${user.id} and revoked_at is null`)[0].count, 1);

  await withTestRequestCookies(cookies, () => redirected(() =>
    completePasswordReset({}, form({ password: 'Brand New Battery Staple 42!' }, csrfToken))));

  assert.equal((await sql`select count(*)::int count from idoc.auth_sessions where user_id=${user.id} and revoked_at is null`)[0].count, 0);
  const [revoked] = await sql`select revoke_reason as "revokeReason" from idoc.auth_sessions where user_id=${user.id}`;
  assert.equal(revoked.revokeReason, 'password-reset');
  // completePasswordReset never calls setSession -- the reset flow itself creates no new session,
  // it only redirects to the sign-in page for a fresh, deliberate login.
  assert.equal(cookies.get(sessionCookieName()), undefined);
  const [notification] = await sql`select kind, recipient_email as "recipientEmail" from idoc.auth_security_notification_outbox where user_id=${user.id}`;
  assert.equal(notification.kind, 'password_reset_completed');
  assert.equal(notification.recipientEmail, user.email);
  const [updatedRow] = await sql`select session_version as "sessionVersion" from idoc.users where id=${user.id}`;
  assert.equal(updatedRow.sessionVersion, fullUser.sessionVersion + 1);
});

test('AUTH-RECOVERY: a request carrying neither a valid general token nor the real pending nonce still fails closed on both verify and complete', async () => {
  const user = await createUser();
  const code = '654987';
  await insertResetOtp(user.id, user.email, code);
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, () => startPendingPasswordReset({ email: user.email, stage: 'email-otp', subjectId: user.id }));
  await assert.rejects(withTestRequestCookies(cookies, () =>
    verifyPasswordResetOtp({}, form({ code }, 'neither-real-value-nor-the-nonce'))));

  const authorizedCookies = new TestCookies();
  const authorizedCsrf = await issueTestCsrfToken(authorizedCookies, null);
  await withTestRequestCookies(authorizedCookies, () => startPendingPasswordReset({ email: user.email, stage: 'email-otp', subjectId: user.id }));
  await insertResetOtp(user.id, user.email, code);
  await withTestRequestCookies(authorizedCookies, () => redirected(() =>
    verifyPasswordResetOtp({}, form({ code }, authorizedCsrf))));
  await assert.rejects(withTestRequestCookies(authorizedCookies, () =>
    completePasswordReset({}, form({ password: 'Another Battery Staple 42!' }, 'neither-real-value-nor-the-nonce'))));
});
