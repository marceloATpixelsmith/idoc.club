import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { decodeJwt, SignJWT } from 'jose';
import {
  authorizeAuthenticatorRecovery,
  beginAuthenticatorRecovery,
  confirmTotpEnrollment,
  verifyLoginTotp,
  verifyStepUpTotp,
} from '../app/(login)/mfa/actions.ts';
import { regenerateRecoveryCodes } from '../app/(dashboard)/dashboard/security/actions.ts';
import { beginPrimaryMfa, MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { getPendingStepUp, requireFreshStepUp } from '../lib/auth/mfa/step-up.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { beginTotpEnrollment, completeTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import { REMEMBERED_TOTP_DEVICE_COOKIE } from '../lib/auth/mfa/remembered-device-cookie.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import {
  DEVELOPMENT_SESSION_COOKIE_NAME,
  PRODUCTION_SESSION_COOKIE_NAME,
  clearSession,
  getSession,
  setSession,
} from '../lib/auth/session.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

const applicationId = MFA_APPLICATION_ID;
const encryptionKey = randomBytes(32);
const continuationKey = randomBytes(32);
const recoveryKey = randomBytes(32);
const store = new PostgresMfaStore(sql);

Object.assign(process.env, {
  AUTH_SECRET: 'slice-2-auth-secret-long-enough-for-tests',
  BASE_URL: 'http://localhost:3000',
  MFA_PENDING_AUTH_SIGNING_KEY: continuationKey.toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: recoveryKey.toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'slice2-test',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'slice2-test': encryptionKey.toString('base64url') }),
  RATE_LIMIT_HASH_KEY: 'slice-2-rate-limit-secret-long-enough',
});

type CookieWrite = { name: string; options?: Record<string, unknown>; value: string };
class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  readonly writes: CookieWrite[] = [];
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string, options?: Record<string, unknown>) {
    this.writes.push({ name, options, value });
    value ? this.values.set(name, value) : this.values.delete(name);
  }
  clone() {
    const clone = new TestCookies();
    for (const [name, value] of this.values) clone.values.set(name, value);
    return clone;
  }
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

function form(name: string, value: string) { const data = new FormData(); data.set(name, value); return data; }

async function dbUser(id: number) {
  const [user] = await sql<Record<string, unknown>[]>`select * from idoc.users where id=${id}`;
  assert.ok(user);
  return {
    ...user,
    accountState: user.account_state,
    deletedAt: user.deleted_at,
    emailVerifiedAt: user.email_verified_at,
    sessionVersion: Number(user.session_version),
  } as any;
}

async function privilegedTotpUser() {
  const user = await createUser();
  await grantRole(user.id, 'administrator');
  const enrolledAt = Date.now() - 30_000;
  const enrollment = await beginTotpEnrollment({
    accountLabel: user.email, applicationId, encryptionKey, issuer: 'IDOC', keyId: 'slice2-test',
    nowMs: enrolledAt, store, subjectId: String(user.id),
  });
  const secret = new URL(enrollment.provisioningUri).searchParams.get('secret')!;
  const completed = await completeTotpEnrollment({
    applicationId, code: totp(secret, enrolledAt), factorId: enrollment.factorId, nowMs: enrolledAt,
    resolveKey: () => encryptionKey, store, subjectId: String(user.id), transactionId: enrollment.transactionId,
  });
  assert.equal(completed.status, 'activated');
  return { secret, user: await dbUser(user.id) };
}

function actorBoundary<T>(userId: number, operation: () => Promise<T>) {
  return withTestMembershipBoundary({ actor: { id: userId, roles: ['administrator'] } }, operation);
}

async function recoveryCodeCount(userId: number) {
  return Number((await sql<{ count: number }[]>`select count(*)::int count from idoc.mfa_recovery_codes where user_id=${userId}`)[0].count);
}

async function rateRows(purpose: string) {
  return sql<{ request_count: number }[]>`select request_count::int from idoc.account_request_limits where purpose=${purpose} order by request_count`;
}

async function fulfilledStepUp(cookies: TestCookies, user: any, secret: string, action: 'generate-recovery-codes' | 'change-security-settings' = 'generate-recovery-codes') {
  const started = await withTestRequestCookies(cookies, () => requireFreshStepUp(user, action, '/dashboard/security'));
  assert.equal(started.required, true);
  const pending = await withTestRequestCookies(cookies, getPendingStepUp);
  assert.ok(pending);
  await withTestRequestCookies(cookies, () => verifyStepUpTotp({}, form('code', totp(secret))))
    .then(() => assert.fail('successful step-up verification should redirect'),
      (error) => assert.match(String(error), /NEXT_REDIRECT/));
  assert.ok(cookies.get('idoc_fresh_step_up'));
}

test('AUTH-COOKIE-002 exercises the real production session cookie and persisted registry', async () => {
  const fixture = await privilegedTotpUser();
  const cookies = new TestCookies();
  const productionEnvironment = { ...process.env, NODE_ENV: 'production' as const };

  await withTestRequestCookies(cookies, async () => {
    await setSession(fixture.user);
    assert.ok(cookies.get(PRODUCTION_SESSION_COOKIE_NAME));
    assert.equal(cookies.get(DEVELOPMENT_SESSION_COOKIE_NAME), undefined);
    const issued = cookies.writes.find((write) => write.name === PRODUCTION_SESSION_COOKIE_NAME && write.value);
    assert.ok(issued);
    assert.equal(issued.options?.secure, true);
    assert.equal(issued.options?.httpOnly, true);
    assert.equal(issued.options?.sameSite, 'lax');
    assert.equal(issued.options?.path, '/');
    assert.equal('domain' in (issued.options ?? {}), false);

    const session = await getSession();
    assert.ok(session);
    assert.equal(session.user.id, fixture.user.id);
    const [registered] = await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions
      where session_id=${session.sessionId} and user_id=${fixture.user.id} and revoked_at is null`;
    assert.equal(registered.count, 1);

    await clearSession();
    const cleared = cookies.writes.filter((write) => write.name === PRODUCTION_SESSION_COOKIE_NAME).at(-1);
    assert.ok(cleared);
    assert.equal(cleared.value, '');
    assert.equal(cleared.options?.secure, true);
    assert.equal(cleared.options?.httpOnly, true);
    assert.equal(cleared.options?.path, '/');
    assert.equal('domain' in (cleared.options ?? {}), false);
    assert.equal(cookies.get(PRODUCTION_SESSION_COOKIE_NAME), undefined);
    assert.equal(cookies.get(DEVELOPMENT_SESSION_COOKIE_NAME), undefined);
    assert.equal(await getSession(), null);
    const [revoked] = await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions
      where session_id=${session.sessionId} and user_id=${fixture.user.id} and revoked_at is not null`;
    assert.equal(revoked.count, 1);
  }, 'idoc.example.test', productionEnvironment);
});

test('AUTH-RATE-006 drives each real MFA action through its purpose-specific atomic limiter', async (t) => {
  await t.test('mfa_login_verify', async () => {
    const fixture = await privilegedTotpUser();
    const cookies = new TestCookies();
    await withTestRequestCookies(cookies, async () => {
      assert.equal(await beginPrimaryMfa(fixture.user, 'password', '/dashboard'), true);
      const results = await Promise.all(Array.from({ length: 5 }, () => verifyLoginTotp({}, form('code', '000000'))));
      assert.equal(results.filter((result) => String((result as { error?: string }).error).includes('Too many attempts')).length, 2);
    }, 'login-rate.example.test');
    const rows = await rateRows('mfa_login_verify');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.request_count), [5, 5]);
    assert.equal((await rateRows('mfa_recovery_code_verify')).length, 0);
  });

  await t.test('mfa_recovery_code_verify', async () => {
    await resetIdoc();
    const fixture = await privilegedTotpUser();
    const cookies = new TestCookies();
    await withTestRequestCookies(cookies, async () => {
      assert.equal(await beginPrimaryMfa(fixture.user, 'password', '/dashboard'), true);
      assert.deepEqual(await beginAuthenticatorRecovery({}, form('recover', 'yes')), { success: 'Enter one of your recovery codes.' });
      const results = await Promise.all(Array.from({ length: 5 }, () => authorizeAuthenticatorRecovery({}, form('recoveryCode', `invalid-${randomUUID()}`))));
      assert.equal(results.filter((result) => String((result as { error?: string }).error).includes('Too many attempts')).length, 2);
    }, 'recovery-rate.example.test');
    const rows = await rateRows('mfa_recovery_code_verify');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.request_count), [5, 5]);
    assert.equal((await rateRows('mfa_login_verify')).length, 0);
  });

  await t.test('mfa_enrollment_confirm', async () => {
    await resetIdoc();
    const user = await createUser();
    await grantRole(user.id, 'administrator');
    const account = await dbUser(user.id);
    const cookies = new TestCookies();
    await withTestRequestCookies(cookies, async () => {
      assert.equal(await beginPrimaryMfa(account, 'password', '/dashboard'), true);
      const results = await Promise.all(Array.from({ length: 5 }, () => confirmTotpEnrollment({}, form('code', '000000'))));
      assert.equal(results.filter((result) => String((result as { error?: string }).error).includes('Too many attempts')).length, 2);
    }, 'enrollment-rate.example.test');
    const rows = await rateRows('mfa_enrollment_confirm');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.request_count), [5, 5]);
    assert.equal((await rateRows('mfa_step_up_verify')).length, 0);
  });

  await t.test('mfa_step_up_verify remains isolated from the other three purposes', async () => {
    await resetIdoc();
    const fixture = await privilegedTotpUser();
    const cookies = new TestCookies();
    await withTestRequestCookies(cookies, async () => {
      await setSession(fixture.user);
      assert.equal((await requireFreshStepUp(fixture.user, 'generate-recovery-codes', '/dashboard/security')).required, true);
      const results = await Promise.all(Array.from({ length: 5 }, () => verifyStepUpTotp({}, form('code', '000000'))));
      assert.equal(results.filter((result) => String((result as { error?: string }).error).includes('Too many attempts')).length, 2);
    }, 'step-up-rate.example.test');
    const rows = await rateRows('mfa_step_up_verify');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.request_count), [5, 5]);
    for (const purpose of ['mfa_login_verify', 'mfa_recovery_code_verify', 'mfa_enrollment_confirm']) {
      assert.equal((await rateRows(purpose)).length, 0);
    }
  });
});

test('AUTH-STEPUP-003 binds fresh authority to user, session, version, role, action, freshness, and one use', async (t) => {
  await t.test('real sensitive mutation requires and consumes one exact fresh TOTP proof', async () => {
    const fixture = await privilegedTotpUser();
    const cookies = new TestCookies();
    await withTestRequestCookies(cookies, async () => {
      await setSession(fixture.user);
      const before = await recoveryCodeCount(fixture.user.id);
      await actorBoundary(fixture.user.id, async () => {
        const blocked = await regenerateRecoveryCodes({}, new FormData());
        assert.equal(blocked, undefined);
      }).then(() => assert.fail('missing fresh proof should redirect'), (error) => assert.match(String(error), /NEXT_REDIRECT/));
      assert.equal(await recoveryCodeCount(fixture.user.id), before);
      await fulfilledStepUp(cookies, fixture.user, fixture.secret);
      const savedAuthority = cookies.get('idoc_fresh_step_up')!.value;
      const result = await actorBoundary(fixture.user.id, () => regenerateRecoveryCodes({}, new FormData()));
      assert.ok((result as { recoveryCodes?: string[] }).recoveryCodes?.length);
      const after = await recoveryCodeCount(fixture.user.id);
      assert.ok(after > 0);
      assert.equal(cookies.get('idoc_fresh_step_up'), undefined);

      cookies.set('idoc_fresh_step_up', savedAuthority);
      await actorBoundary(fixture.user.id, () => regenerateRecoveryCodes({}, new FormData()))
        .then(() => assert.fail('replayed fresh authority should redirect'), (error) => assert.match(String(error), /NEXT_REDIRECT/));
      assert.equal(await recoveryCodeCount(fixture.user.id), after);
    }, 'step-up-use.example.test');
  });

  await t.test('action and session binding reject otherwise-valid authority', async () => {
    await resetIdoc();
    const fixture = await privilegedTotpUser();
    const cookies = new TestCookies();
    await withTestRequestCookies(cookies, async () => {
      await setSession(fixture.user);
      await fulfilledStepUp(cookies, fixture.user, fixture.secret, 'change-security-settings');
      const before = await recoveryCodeCount(fixture.user.id);
      await actorBoundary(fixture.user.id, () => regenerateRecoveryCodes({}, new FormData()))
        .then(() => assert.fail('wrong-action authority should redirect'), (error) => assert.match(String(error), /NEXT_REDIRECT/));
      assert.equal(await recoveryCodeCount(fixture.user.id), before);

      await fulfilledStepUp(cookies, fixture.user, fixture.secret);
      await setSession(fixture.user);
      await actorBoundary(fixture.user.id, () => regenerateRecoveryCodes({}, new FormData()))
        .then(() => assert.fail('different-session authority should redirect'), (error) => assert.match(String(error), /NEXT_REDIRECT/));
      assert.equal(await recoveryCodeCount(fixture.user.id), before);
    }, 'step-up-binding.example.test');
  });

  await t.test('sessionVersion, role, expiry, remembered-device, cross-user, and forged fields fail closed', async () => {
    await resetIdoc();
    const first = await privilegedTotpUser();
    const second = await privilegedTotpUser();

    const staleCookies = new TestCookies();
    await withTestRequestCookies(staleCookies, async () => {
      await setSession(first.user);
      await fulfilledStepUp(staleCookies, first.user, first.secret);
      const authority = staleCookies.get('idoc_fresh_step_up')!.value;
      const payload = decodeJwt(authority);
      const mismatchedVersion = await new SignJWT({ ...payload, sessionVersion: Number(payload.sessionVersion) + 1 })
        .setProtectedHeader({ alg: 'HS256' }).sign(continuationKey);
      staleCookies.set('idoc_fresh_step_up', mismatchedVersion);
      const before = await recoveryCodeCount(first.user.id);
      await actorBoundary(first.user.id, () => regenerateRecoveryCodes({}, new FormData()))
        .then(() => assert.fail('mismatched evidence sessionVersion must fail'), (error) => assert.match(String(error), /NEXT_REDIRECT/));
      assert.equal(await recoveryCodeCount(first.user.id), before);
    }, 'step-up-version.example.test');

    await resetIdoc();
    const roleFixture = await privilegedTotpUser();
    const roleCookies = new TestCookies();
    await withTestRequestCookies(roleCookies, async () => {
      await setSession(roleFixture.user);
      await fulfilledStepUp(roleCookies, roleFixture.user, roleFixture.secret);
      const authority = roleCookies.get('idoc_fresh_step_up')!.value;
      const payload = decodeJwt(authority);
      const mismatchedRole = await new SignJWT({ ...payload, role: 'super-admin' })
        .setProtectedHeader({ alg: 'HS256' }).sign(continuationKey);
      roleCookies.set('idoc_fresh_step_up', mismatchedRole);
      const before = await recoveryCodeCount(roleFixture.user.id);
      await actorBoundary(roleFixture.user.id, () => regenerateRecoveryCodes({}, new FormData()))
        .then(() => assert.fail('mismatched evidence role must fail'), (error) => assert.match(String(error), /NEXT_REDIRECT/));
      assert.equal(await recoveryCodeCount(roleFixture.user.id), before);
    }, 'step-up-role.example.test');

    await resetIdoc();
    const expiryFixture = await privilegedTotpUser();
    const expiryCookies = new TestCookies();
    await withTestRequestCookies(expiryCookies, async () => {
      await setSession(expiryFixture.user);
      await fulfilledStepUp(expiryCookies, expiryFixture.user, expiryFixture.secret);
      const token = expiryCookies.get('idoc_fresh_step_up')!.value;
      const payload = decodeJwt(token);
      const expired = await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 600).setExpirationTime(Math.floor(Date.now() / 1000) - 1)
        .sign(continuationKey);
      expiryCookies.set('idoc_fresh_step_up', expired);
      expiryCookies.set(REMEMBERED_TOTP_DEVICE_COOKIE, 'remembered-device-alone');
      const before = await recoveryCodeCount(expiryFixture.user.id);
      await actorBoundary(expiryFixture.user.id, () => regenerateRecoveryCodes({}, new FormData()))
        .then(() => assert.fail('expired/remembered-only authority should redirect'), (error) => assert.match(String(error), /NEXT_REDIRECT/));
      assert.equal(await recoveryCodeCount(expiryFixture.user.id), before);
    }, 'step-up-expiry.example.test');

    await resetIdoc();
    const owner = await privilegedTotpUser();
    const attacker = await privilegedTotpUser();
    const crossCookies = new TestCookies();
    await withTestRequestCookies(crossCookies, async () => {
      await setSession(owner.user);
      await fulfilledStepUp(crossCookies, owner.user, owner.secret);
      const authority = crossCookies.get('idoc_fresh_step_up')!.value;
      await setSession(attacker.user);
      crossCookies.set('idoc_fresh_step_up', authority);
      const forged = new FormData();
      forged.set('userId', String(owner.user.id));
      forged.set('action', 'generate-recovery-codes');
      forged.set('sessionId', 'forged');
      forged.set('role', 'super-admin');
      const ownerBefore = await recoveryCodeCount(owner.user.id);
      const attackerBefore = await recoveryCodeCount(attacker.user.id);
      await actorBoundary(attacker.user.id, () => regenerateRecoveryCodes({}, forged))
        .then(() => assert.fail('cross-user authority should redirect'), (error) => assert.match(String(error), /NEXT_REDIRECT/));
      assert.equal(await recoveryCodeCount(owner.user.id), ownerBefore);
      assert.equal(await recoveryCodeCount(attacker.user.id), attackerBefore);
    }, 'step-up-cross-user.example.test');
  });
});