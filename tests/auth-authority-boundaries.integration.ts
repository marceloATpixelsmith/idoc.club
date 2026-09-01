import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { completeSignup } from '../app/(login)/sign-up/actions.ts';
import { verifyLoginOtp } from '../app/(login)/sign-in/actions.ts';
import { signIn, updateAccount } from '../app/(login)/actions.ts';
import { verifyLoginTotp } from '../app/(login)/mfa/actions.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { markPendingSignupVerified, startPendingSignup } from '../lib/auth/pending-signup.ts';
import { requireLoginOtp, startPendingLogin } from '../lib/auth/pending-login.ts';
import { getPendingPrimaryAuth } from '../lib/auth/mfa/pending-primary-auth.ts';
import { beginPrimaryMfa, MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { digestRememberedDeviceToken, issueRememberedDevice } from '../lib/auth/mfa/remembered-device.ts';
import { REMEMBERED_TOTP_DEVICE_COOKIE } from '../lib/auth/mfa/remembered-device-cookie.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { beginTotpEnrollment, completeTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import { hashPassword, sessionCookieName } from '../lib/auth/session.ts';
import { db } from '../lib/db/drizzle.ts';
import { users } from '../lib/db/schema.ts';
import { eq } from 'drizzle-orm';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

const password = 'Correct Horse Battery Staple 42!';
const encryptionKey = randomBytes(32);
const rememberedKey = randomBytes(32);
const store = new PostgresMfaStore(sql);

Object.assign(process.env, {
  AUTH_SECRET: 'integration-auth-secret-that-is-long-enough',
  BASE_URL: 'http://localhost:3000',
  MFA_PENDING_AUTH_SIGNING_KEY: randomBytes(32).toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: randomBytes(32).toString('base64url'),
  MFA_REMEMBERED_DEVICE_DIGEST_KEY: rememberedKey.toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'integration',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ integration: encryptionKey.toString('base64url') }),
  RATE_LIMIT_HASH_KEY: 'integration-rate-limit-secret-is-long-enough',
});

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

beforeEach(async () => {
  process.env.REMEMBER_TOTP_DEVICE_ENABLED = 'false';
  await resetIdoc();
});
after(closeHarness);

async function userWithPassword(privileged = true) {
  const fixture = await createUser();
  await sql`update idoc.users set password_hash=${await hashPassword(password)} where id=${fixture.id}`;
  if (privileged) await grantRole(fixture.id, 'administrator');
  return (await db.select().from(users).where(eq(users.id, fixture.id)).limit(1))[0];
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

async function activeFactor(user: { email: string; id: number }, nowMs = Date.now()) {
  const enrollment = await beginTotpEnrollment({ accountLabel: user.email, applicationId: MFA_APPLICATION_ID,
    encryptionKey, issuer: 'IDOC', keyId: 'integration', nowMs, store, subjectId: String(user.id) });
  const secret = new URL(enrollment.provisioningUri).searchParams.get('secret')!;
  const result = await completeTotpEnrollment({ applicationId: MFA_APPLICATION_ID,
    code: generateTotpCode(secret, nowMs), factorId: enrollment.factorId, nowMs,
    resolveKey: () => encryptionKey, store, subjectId: String(user.id), transactionId: enrollment.transactionId });
  assert.equal(result.status, 'activated');
  return { factorId: enrollment.factorId, secret };
}

async function issueRememberedCookies(userId: number, factorId: string) {
  const issued = await issueRememberedDevice({ applicationId: MFA_APPLICATION_ID, days: 30,
    digestSecret: rememberedKey, factorId, store, subjectId: String(userId) });
  const cookies = new TestCookies();
  cookies.set(REMEMBERED_TOTP_DEVICE_COOKIE, issued.token);
  return { cookies, digest: digestRememberedDeviceToken(issued.token, rememberedKey) };
}

async function redirected(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => String(error).includes('NEXT_REDIRECT'));
}

test('AUTH-IDENTITY-002: real signup action ignores hostile authority fields and creates no privileged grant', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.pwnedpasswords.com/range/')) return new Response('', { status: 200 });
    return originalFetch(input, init);
  };
  try {
    for (const authority of [
      ['role', 'administrator'], ['role', 'super_admin'], ['applicationRole', 'administrator'],
      ['applicationRole', 'super_admin'], ['isAdmin', 'true'], ['actorId', '1'],
    ]) {
      const cookies = new TestCookies();
      const email = `hostile-${authority[0]}-${authority[1]}@example.test`;
      await withTestRequestCookies(cookies, async () => {
        await startPendingSignup(email);
        await markPendingSignupVerified(email);
        const form = new FormData();
        form.set('password', password);
        form.set(authority[0], authority[1]);
        await redirected(() => completeSignup({}, form));
      });
      const [created] = await sql`select id,role from idoc.users where email=${email}`;
      assert.equal(created.role, 'member');
      assert.equal((await sql`select count(*)::int count from idoc.application_roles where user_id=${created.id}`)[0].count, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AUTH-MFA-004: beginPrimaryMfa composes authoritative role, factor, policy, cookie, and persisted remembered evidence', async () => {
  const privileged = await userWithPassword();
  const factor = await activeFactor(privileged);
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, async () => {
    assert.equal(await beginPrimaryMfa(privileged, 'password', '/dashboard'), true);
    assert.equal((await getPendingPrimaryAuth())?.stage, 'challenge');
  });

  const unenrolled = await userWithPassword();
  await withTestRequestCookies(new TestCookies(), async () => {
    assert.equal(await beginPrimaryMfa(unenrolled, 'password', '/dashboard'), true);
    assert.equal((await getPendingPrimaryAuth())?.stage, 'enrollment');
  });

  process.env.REMEMBER_TOTP_DEVICE_ENABLED = 'true';
  const validRemembered = await issueRememberedCookies(privileged.id, factor.factorId);
  await withTestRequestCookies(validRemembered.cookies, async () => assert.equal(
    await beginPrimaryMfa(privileged, 'password', '/dashboard'), false));

  process.env.REMEMBER_TOTP_DEVICE_ENABLED = 'false';
  await withTestRequestCookies(validRemembered.cookies, async () => assert.equal(
    await beginPrimaryMfa(privileged, 'password', '/dashboard'), true));
  process.env.REMEMBER_TOTP_DEVICE_ENABLED = 'true';

  const expired = await issueRememberedCookies(privileged.id, factor.factorId);
  await sql`update idoc.mfa_remembered_devices set expires_at=now()-interval '1 second' where token_digest=${expired.digest}`;
  await withTestRequestCookies(expired.cookies, async () => assert.equal(
    await beginPrimaryMfa(privileged, 'password', '/dashboard'), true));

  const revoked = await issueRememberedCookies(privileged.id, factor.factorId);
  await sql`update idoc.mfa_remembered_devices set revoked_at=now() where token_digest=${revoked.digest}`;
  await withTestRequestCookies(revoked.cookies, async () => assert.equal(
    await beginPrimaryMfa(privileged, 'password', '/dashboard'), true));

  const staleFactor = await issueRememberedCookies(privileged.id, factor.factorId);
  await sql`update idoc.mfa_factors set status='revoked', revoked_at=now() where id=${factor.factorId}`;
  await withTestRequestCookies(staleFactor.cookies, async () => assert.equal(
    await beginPrimaryMfa(privileged, 'password', '/dashboard'), true));
  await sql`update idoc.mfa_factors set status='active', revoked_at=null where id=${factor.factorId}`;

  const wrongUser = await issueRememberedCookies(privileged.id, factor.factorId);
  const other = await userWithPassword();
  await activeFactor(other);
  await withTestRequestCookies(wrongUser.cookies, async () => assert.equal(
    await beginPrimaryMfa(other, 'password', '/dashboard'), true));

  const malformed = new TestCookies();
  malformed.set(REMEMBERED_TOTP_DEVICE_COOKIE, 'malformed-token');
  await withTestRequestCookies(malformed, async () => assert.equal(
    await beginPrimaryMfa(privileged, 'password', '/dashboard'), true));

  const member = await userWithPassword(false);
  await withTestRequestCookies(new TestCookies(), async () => assert.equal(
    await beginPrimaryMfa(member, 'password', '/dashboard'), false));
});

test('AUTH-SESSION-008: password login creates only pending MFA until a valid TOTP completes', async () => {
  const user = await userWithPassword();
  const { secret } = await activeFactor(user);
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(user.email);
    const form = new FormData(); form.set('email', user.email); form.set('password', password);
    await redirected(() => signIn({}, form));
    assert.equal((await getPendingPrimaryAuth())?.stage, 'challenge');
    assert.equal(cookies.get(sessionCookieName()), undefined);
    assert.equal((await sql`select count(*)::int count from idoc.auth_sessions where user_id=${user.id} and revoked_at is null`)[0].count, 0);
    const invalid = new FormData(); invalid.set('code', '000000');
    assert.deepEqual(await verifyLoginTotp({}, invalid), { error: 'That authenticator code is incorrect.' });
    assert.equal((await sql`select count(*)::int count from idoc.auth_sessions where user_id=${user.id}`)[0].count, 0);
    const valid = new FormData(); valid.set('code', generateTotpCode(secret));
    await redirected(() => verifyLoginTotp({}, valid));
    assert.ok(cookies.get(sessionCookieName()));
    assert.equal((await sql`select count(*)::int count from idoc.auth_sessions where user_id=${user.id} and revoked_at is null`)[0].count, 1);
  });
});

test('AUTH-OTP-002: valid email OTP cannot become MFA, step-up, or privileged session authority', async () => {
  const user = await userWithPassword();
  await activeFactor(user);
  await sql`update idoc.users set email_verified_at=null where id=${user.id}`;
  const code = '123456';
  await sql`insert into idoc.email_otp_codes(user_id,email,purpose,code_hash,expires_at)
    values(${user.id},${user.email},'login_verification',${createHash('sha256').update(code).digest('hex')},now()+interval '10 minutes')`;
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, async () => {
    await requireLoginOtp(user.email, user.id, user.sessionVersion, false);
    const pendingLoginToken = cookies.get('idoc_pending_login')?.value;
    assert.ok(pendingLoginToken);
    const form = new FormData(); form.set('code', code);
    await redirected(() => verifyLoginOtp({}, form));
    assert.equal((await getPendingPrimaryAuth())?.stage, 'challenge');
    assert.equal(cookies.get(sessionCookieName()), undefined);
    assert.equal(cookies.get('idoc_fresh_step_up'), undefined);
    assert.equal((await sql`select count(*)::int count from idoc.auth_sessions where user_id=${user.id}`)[0].count, 0);
    cookies.set('idoc_pending_primary_mfa', pendingLoginToken);
    assert.equal(await getPendingPrimaryAuth(), null);
  });
});

test('AUTH-API-002: protected account mutation uses the signed server session, never forged subject fields', async () => {
  const actor = await userWithPassword(false);
  const victim = await userWithPassword(false);
  const cookies = new TestCookies();
  await withTestRequestCookies(cookies, async () => {
    const { setSession } = await import('../lib/auth/session.ts');
    await setSession(actor);
    await withTestMembershipBoundary({ actor: { id: actor.id, roles: [] } }, async () => {
      const form = new FormData();
      form.set('name', 'Actor changed'); form.set('email', actor.email);
      form.set('userId', String(victim.id)); form.set('id', String(victim.id));
      form.set('actorId', String(victim.id)); form.set('subject', JSON.stringify({ id: victim.id }));
      assert.deepEqual(await updateAccount({}, form), { name: 'Actor changed', success: 'Account updated successfully.' });
    });
  });
  assert.equal((await sql`select name from idoc.users where id=${actor.id}`)[0].name, 'Actor changed');
  assert.notEqual((await sql`select name from idoc.users where id=${victim.id}`)[0].name, 'Actor changed');
  const anonymous = new FormData(); anonymous.set('name', 'Anonymous'); anonymous.set('email', victim.email);
  anonymous.set('userId', String(victim.id));
  await withTestRequestCookies(new TestCookies(), async () => assert.rejects(
    () => updateAccount({}, anonymous), /User is not authenticated/));
  assert.notEqual((await sql`select name from idoc.users where id=${victim.id}`)[0].name, 'Anonymous');
});