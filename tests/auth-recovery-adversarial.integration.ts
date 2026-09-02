import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { SignJWT } from 'jose';
import {
  acknowledgeRecoveryCodes,
  authorizeAuthenticatorRecovery,
  beginAuthenticatorRecovery,
  confirmTotpEnrollment,
} from '../app/(login)/mfa/actions.ts';
import {
  getPendingPrimaryAuth,
  setPendingPrimaryAuth,
  type PendingPrimaryAuth,
} from '../lib/auth/mfa/pending-primary-auth.ts';
import { beginPrimaryMfa, MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { digestRecoveryCode } from '../lib/auth/mfa/recovery.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { beginTotpEnrollment, completeTotpEnrollment, decryptTotpSecret } from '../lib/auth/mfa/totp.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { sessionCookieName, setSession } from '../lib/auth/session.ts';
import { csrfCookieName } from '../lib/security/csrf-tokens.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

const applicationId = MFA_APPLICATION_ID;
const cookieName = 'idoc_pending_primary_mfa';
const encryptionKey = randomBytes(32);
const continuationKey = randomBytes(32);
const recoveryKey = randomBytes(32);
const recoveryCode = 'ABCD1234-EFGH5678-IJKL9012-MNOP3456';
const store = new PostgresMfaStore(sql);

Object.assign(process.env, {
  AUTH_SECRET: 'auth-recovery-integration-secret-long-enough',
  BASE_URL: 'http://localhost:3000',
  MFA_PENDING_AUTH_SIGNING_KEY: continuationKey.toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: recoveryKey.toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'recovery-test',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'recovery-test': encryptionKey.toString('base64url') }),
  RATE_LIMIT_HASH_KEY: 'auth-recovery-rate-limit-secret-long-enough',
});

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
  clone() { const clone = new TestCookies(); for (const [name, value] of this.values) clone.set(name, value); return clone; }
}

beforeEach(resetIdoc);
after(closeHarness);

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

function form(name: string, value: string, csrfToken: string) { const data = new FormData(); data.set(name, value); data.set('csrf_token', csrfToken); return data; }
function csrfTokenFrom(cookies: TestCookies): string { return cookies.get(csrfCookieName())?.value ?? ''; }
async function redirected(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => String(error).includes('NEXT_REDIRECT'));
}

async function createRecoveryUser() {
  const user = await createUser();
  await grantRole(user.id, 'administrator');
  const enrollment = await beginTotpEnrollment({ accountLabel: user.email, applicationId, encryptionKey,
    issuer: 'IDOC', keyId: 'recovery-test', nowMs: Date.now() - 30_000, store, subjectId: String(user.id) });
  const secret = new URL(enrollment.provisioningUri).searchParams.get('secret')!;
  assert.equal((await completeTotpEnrollment({ applicationId, code: totp(secret, Date.now() - 30_000),
    factorId: enrollment.factorId, nowMs: Date.now() - 30_000, resolveKey: () => encryptionKey,
    store, subjectId: String(user.id), transactionId: enrollment.transactionId })).status, 'activated');
  await sql`insert into idoc.mfa_recovery_codes(recovery_code_id,user_id,application_id,generation_id,digest)
    values(${randomUUID()},${user.id},${applicationId},${randomUUID()},${digestRecoveryCode(recoveryCode, recoveryKey)})`;
  const [fresh] = await sql<{ id: number; email: string; session_version: number }[]>`
    select id,email,session_version from idoc.users where id=${user.id}`;
  return { factorId: enrollment.factorId, user: { ...user, sessionVersion: fresh.session_version } };
}

async function recoveryEntry(provided?: Awaited<ReturnType<typeof createRecoveryUser>>) {
  const fixture = provided ?? await createRecoveryUser();
  const cookies = new TestCookies();
  await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, async () => {
    assert.equal(await beginPrimaryMfa(fixture.user as never, 'password', '/dashboard/admin'), true);
    assert.deepEqual(await beginAuthenticatorRecovery({}, form('recover', 'yes', csrfTokenFrom(cookies))), { success: 'Enter one of your recovery codes.' });
  });
  return { ...fixture, cookies };
}

async function replacement(provided?: Awaited<ReturnType<typeof recoveryEntry>>) {
  const entry = provided ?? await recoveryEntry();
  await withTestRequestCookies(entry.cookies, () => redirected(() =>
    authorizeAuthenticatorRecovery({}, form('recoveryCode', recoveryCode, csrfTokenFrom(entry.cookies)))));
  const pending = await withTestRequestCookies(entry.cookies, getPendingPrimaryAuth);
  assert.equal(pending?.stage, 'replacement');
  return { ...entry, pending: pending! };
}

async function recoveryAck(provided?: Awaited<ReturnType<typeof replacement>>) {
  const entry = provided ?? await replacement();
  const [factor] = await sql<{ encrypted_secret: string }[]>`
    select encrypted_secret from idoc.mfa_factors where factor_id=${entry.pending.factorId}`;
  const secret = decryptTotpSecret(factor.encrypted_secret, () => encryptionKey);
  const result = await withTestRequestCookies(entry.cookies, () =>
    confirmTotpEnrollment({}, form('code', totp(secret), csrfTokenFrom(entry.cookies))));
  assert.match(String((result as { success?: string }).success), /replaced/);
  const pending = await withTestRequestCookies(entry.cookies, getPendingPrimaryAuth);
  assert.equal(pending?.stage, 'recovery-ack');
  return { ...entry, pending: pending! };
}

async function state(userId: number) {
  const [row] = await sql`select
    (select session_version from idoc.users where id=${userId}) session_version,
    (select count(*)::int from idoc.auth_sessions where user_id=${userId}) sessions,
    (select count(*)::int from idoc.mfa_factors where user_id=${userId}) factors,
    (select count(*)::int from idoc.mfa_factors where user_id=${userId} and status='active') active_factors,
    (select count(*)::int from idoc.mfa_factors where user_id=${userId} and status='pending') pending_factors,
    (select count(*)::int from idoc.mfa_enrollment_transactions where user_id=${userId}) enrollments,
    (select count(*)::int from idoc.mfa_recovery_codes where user_id=${userId}) recovery_codes,
    (select count(*)::int from idoc.mfa_recovery_codes where user_id=${userId} and consumed_at is not null) consumed_codes,
    (select count(*)::int from idoc.audit_log where actor_id=${userId}) audits,
    (select count(*)::int from idoc.auth_security_notification_outbox where user_id=${userId}) notifications`;
  return row;
}

async function expiredToken(pending: PendingPrimaryAuth) {
  return new SignJWT(pending).setProtectedHeader({ alg: 'HS256' }).setIssuedAt(Math.floor(Date.now() / 1000) - 120)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(continuationKey);
}

async function assertNoSession(cookies: TestCookies, userId: number) {
  assert.equal(cookies.get(sessionCookieName()), undefined);
  assert.equal((await sql`select count(*)::int count from idoc.auth_sessions where user_id=${userId}`)[0].count, 0);
}

test('AUTH-RECOVERY-005 expired recovery-entry, replacement, and acknowledgement authority fail closed', async (t) => {
  await t.test('expired recovery-entry preserves the code, factor, and persisted evidence', async () => {
    const entry = await recoveryEntry(); const before = await state(entry.user.id);
    const pending = await withTestRequestCookies(entry.cookies, getPendingPrimaryAuth); assert.ok(pending);
    entry.cookies.set(cookieName, await expiredToken(pending));
    assert.deepEqual(await withTestRequestCookies(entry.cookies, () => authorizeAuthenticatorRecovery({}, form('recoveryCode', recoveryCode, csrfTokenFrom(entry.cookies)))),
      { error: 'Your recovery session expired. Sign in again.' });
    assert.deepEqual(await state(entry.user.id), before); assert.equal(entry.cookies.get(cookieName), undefined);
    await assertNoSession(entry.cookies, entry.user.id);
  });
  await t.test('expired replacement preserves the old factor and recovery generation', async () => {
    await resetIdoc(); const entry = await replacement(); const before = await state(entry.user.id);
    entry.cookies.set(cookieName, await expiredToken(entry.pending));
    assert.deepEqual(await withTestRequestCookies(entry.cookies, () => confirmTotpEnrollment({}, form('code', '123456', csrfTokenFrom(entry.cookies)))),
      { error: 'Your setup session expired. Sign in again.' });
    assert.deepEqual(await state(entry.user.id), before); await assertNoSession(entry.cookies, entry.user.id);
  });
  await t.test('expired recovery acknowledgement creates no session or duplicate evidence', async () => {
    await resetIdoc(); const entry = await recoveryAck(); const before = await state(entry.user.id);
    await sql`update idoc.mfa_enrollment_transactions set expires_at=now()-interval '1 second'
      where transaction_id=${entry.pending.transactionId}`;
    assert.deepEqual(await withTestRequestCookies(entry.cookies, () => acknowledgeRecoveryCodes({}, form('saved', 'yes', csrfTokenFrom(entry.cookies)))),
      { error: 'Your setup session expired. Sign in again.' });
    assert.deepEqual(await state(entry.user.id), before); await assertNoSession(entry.cookies, entry.user.id);
  });
});

test('AUTH-RECOVERY-005 stale session versions fail closed at every recovery action', async (t) => {
  for (const stage of ['recovery-entry', 'replacement', 'recovery-ack'] as const) {
    await t.test(stage, async () => {
      if (stage !== 'recovery-entry') await resetIdoc();
      const entry = stage === 'recovery-entry' ? await recoveryEntry() : stage === 'replacement' ? await replacement() : await recoveryAck();
      await sql`update idoc.users set session_version=session_version+1 where id=${entry.user.id}`;
      const before = await state(entry.user.id);
      const result = await withTestRequestCookies(entry.cookies, () => stage === 'recovery-entry'
        ? authorizeAuthenticatorRecovery({}, form('recoveryCode', recoveryCode, csrfTokenFrom(entry.cookies)))
        : stage === 'replacement' ? confirmTotpEnrollment({}, form('code', '123456', csrfTokenFrom(entry.cookies)))
          : acknowledgeRecoveryCodes({}, form('saved', 'yes', csrfTokenFrom(entry.cookies))));
      assert.match(String((result as { error?: string }).error), /expired/);
      assert.deepEqual(await state(entry.user.id), before); await assertNoSession(entry.cookies, entry.user.id);
    });
  }
});

test('AUTH-RECOVERY-005 cross-user substitution cannot advance entry, replacement, or acknowledgement', async (t) => {
  for (const stage of ['recovery-entry', 'replacement', 'recovery-ack'] as const) {
    await t.test(stage, async () => {
      if (stage !== 'recovery-entry') await resetIdoc();
      const owner = stage === 'recovery-entry' ? await recoveryEntry() : stage === 'replacement' ? await replacement() : await recoveryAck();
      const other = await createRecoveryUser();
      const forged = owner.cookies.clone();
      await withTestRequestCookies(forged, () => setSession(other.user as never));
      const ownerBefore = await state(owner.user.id); const otherBefore = await state(other.user.id);
      const result = await withTestRequestCookies(forged, () => stage === 'recovery-entry'
        ? authorizeAuthenticatorRecovery({}, form('recoveryCode', recoveryCode, csrfTokenFrom(forged)))
        : stage === 'replacement' ? confirmTotpEnrollment({}, form('code', '123456', csrfTokenFrom(forged)))
          : acknowledgeRecoveryCodes({}, form('saved', 'yes', csrfTokenFrom(forged))));
      assert.ok((result as { error?: string }).error); assert.deepEqual(await state(owner.user.id), ownerBefore);
      assert.deepEqual(await state(other.user.id), otherBefore);
    });
  }
});

test('AUTH-RECOVERY-005 old action cookies cannot replay entry, replacement, or successful acknowledgement', async (t) => {
  await t.test('old recovery-entry cannot consume twice or create duplicate enrollment/evidence', async () => {
    const entry = await recoveryEntry(); const old = entry.cookies.clone();
    await withTestRequestCookies(entry.cookies, () => redirected(() => authorizeAuthenticatorRecovery({}, form('recoveryCode', recoveryCode, csrfTokenFrom(entry.cookies)))));
    const after = await state(entry.user.id);
    assert.deepEqual(await withTestRequestCookies(old, () => authorizeAuthenticatorRecovery({}, form('recoveryCode', recoveryCode, csrfTokenFrom(old)))),
      { error: 'That recovery code could not be used.' });
    assert.deepEqual(await state(entry.user.id), after); await assertNoSession(old, entry.user.id);
  });
  await t.test('old replacement cannot activate or rotate twice', async () => {
    await resetIdoc(); const entry = await replacement(); const old = entry.cookies.clone();
    await recoveryAck(entry); const after = await state(entry.user.id);
    assert.deepEqual(await withTestRequestCookies(old, () => confirmTotpEnrollment({}, form('code', '123456', csrfTokenFrom(old)))),
      { error: 'Your setup session expired. Sign in again.' });
    assert.deepEqual(await state(entry.user.id), after); await assertNoSession(old, entry.user.id);
  });
  await t.test('old recovery-ack produces exactly one session and no duplicate mutation', async () => {
    await resetIdoc(); const entry = await recoveryAck(); const old = entry.cookies.clone();
    await withTestRequestCookies(entry.cookies, () => redirected(() => acknowledgeRecoveryCodes({}, form('saved', 'yes', csrfTokenFrom(entry.cookies)))));
    const after = await state(entry.user.id); assert.equal(after.sessions, 1);
    assert.deepEqual(await withTestRequestCookies(old, () => acknowledgeRecoveryCodes({}, form('saved', 'yes', csrfTokenFrom(old)))),
      { error: 'Your setup session expired. Sign in again.' });
    assert.deepEqual(await state(entry.user.id), after); assert.equal(old.get(sessionCookieName()), undefined);
  });
});

test('AUTH-RECOVERY-005 acknowledgement cannot precede replacement', async () => {
  const entry = await replacement();
  await withTestRequestCookies(entry.cookies, () => setPendingPrimaryAuth({ ...entry.pending, stage: 'recovery-ack' }));
  const before = await state(entry.user.id);
  assert.deepEqual(await withTestRequestCookies(entry.cookies, () => acknowledgeRecoveryCodes({}, form('saved', 'yes', csrfTokenFrom(entry.cookies)))),
    { error: 'Your setup session expired. Sign in again.' });
  assert.deepEqual(await state(entry.user.id), before); await assertNoSession(entry.cookies, entry.user.id);
});
