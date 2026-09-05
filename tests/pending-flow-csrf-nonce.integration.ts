import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { signIn } from '../app/(login)/actions.ts';
import { verifyLoginOtp } from '../app/(login)/sign-in/actions.ts';
import { completeSignup, verifySignupOtp } from '../app/(login)/sign-up/actions.ts';
import { completePasswordReset, verifyPasswordResetOtp } from '../app/(login)/recover-password/actions.ts';
import { getPendingLogin, startPendingLogin } from '../lib/auth/pending-login.ts';
import { getPendingSignup, startPendingSignup } from '../lib/auth/pending-signup.ts';
import { getPendingPasswordReset, startPendingPasswordReset } from '../lib/auth/pending-password-reset.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { hashPassword, sessionCookieName } from '../lib/auth/session.ts';
import { db } from '../lib/db/drizzle.ts';
import { users } from '../lib/db/schema.ts';
import { eq } from 'drizzle-orm';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// A real, reproducible production report: the general site-wide CSRF cookie is sourced from a
// React Context living in the root layout, which Next.js can reuse (not re-render) across the
// client-side navigation that follows every redirect() a pending-flow Server Action makes -- so
// the token a later stage's form submits can legitimately drift from the current general cookie
// through no fault of the member's. AUTH-CSRF-003 already proved the fix for the MFA continuation
// flow (lib/auth/mfa/pending-primary-auth.ts); this file proves the identical fix for the three
// other flows sharing the same architecture: login (lib/auth/pending-login.ts), signup
// (lib/auth/pending-signup.ts), and password reset (lib/auth/pending-password-reset.ts). Every
// test below submits the flow's own per-flow csrfNonce as evidence while the request's actual
// general CSRF cookie is left at an unrelated, deliberately-wrong value -- simulating exactly the
// drift a stale layout Context would produce -- and confirms the request still succeeds, while a
// request carrying neither still fails closed.

const password = 'Correct Horse Battery Staple 42!';

Object.assign(process.env, {
  AUTH_SECRET: 'pending-flow-nonce-integration-secret-long-enough',
  BASE_URL: 'http://localhost:3000',
  BREVO_API_KEY: 'integration-only-provider-key',
  BREVO_FROM_EMAIL: 'accounts@idoc.club',
  RATE_LIMIT_HASH_KEY: 'pending-flow-nonce-rate-limit-secret-long-enough',
});

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

const originalFetch = globalThis.fetch;
beforeEach(async () => {
  await resetIdoc();
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://api.brevo.com/v3/smtp/email') return new Response('{"messageId":"<test@smtp-relay.brevo.com>"}', { status: 201 });
    return originalFetch(input, init);
  };
});
after(async () => { globalThis.fetch = originalFetch; await closeHarness(); });

async function redirected(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => String(error).includes('NEXT_REDIRECT'));
}

function form(fields: Record<string, string>, csrfToken: string): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  data.set('csrf_token', csrfToken);
  return data;
}

async function insertOtp(userId: number | null, email: string, purpose: string, code: string) {
  await sql`insert into idoc.email_otp_codes(user_id,email,purpose,code_hash,expires_at)
    values(${userId},${email},${purpose},${createHash('sha256').update(code).digest('hex')},now()+interval '10 minutes')`;
}

/** Wraps `operation` with the already-installed (Brevo-aware) fetch mock additionally answering
 * the HaveIBeenPwned Pwned Passwords range API as "not breached", then restores it -- for the two
 * flows below (signup, password reset) whose completion step calls checkPasswordBreached(). */
async function withPwnedPasswordsClean<T>(operation: () => Promise<T>): Promise<T> {
  const withoutBreachCheck = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.pwnedpasswords.com/range/')) return new Response('', { status: 200 });
    return withoutBreachCheck(input, init);
  };
  try {
    return await operation();
  } finally {
    globalThis.fetch = withoutBreachCheck;
  }
}

test('AUTH-CSRF-003 login: the pending-flow-bound csrfNonce is accepted as an alternative to a drifted general CSRF cookie', async (t) => {
  await t.test('signIn and verifyLoginOtp both succeed on the pending nonce even when the general cookie token is wrong', async () => {
    const user = await createUser();
    // An unverified email routes signIn through its own email_verification OTP branch, reaching
    // requireLoginOtp without ever calling hasValidLoginDeviceTrust() -- that function reads the
    // real Next.js cookies() directly (a separate, pre-existing gap unrelated to this fix) rather
    // than this test harness's requestCookies() shim, so it cannot run under withTestRequestCookies.
    await sql`update idoc.users set password_hash=${await hashPassword(password)}, email_verified_at=null where id=${user.id}`;
    const cookies = new TestCookies();
    await issueTestCsrfToken(cookies, null);

    const stage1 = await withTestRequestCookies(cookies, async () => {
      await startPendingLogin(user.email);
      return (await getPendingLogin())!;
    });
    assert.ok(stage1.csrfNonce);

    await withTestRequestCookies(cookies, () => redirected(() =>
      signIn({}, form({ email: user.email, password }, stage1.csrfNonce))));

    const stage2 = await withTestRequestCookies(cookies, getPendingLogin);
    assert.equal(stage2?.stage, 'login-otp');
    // The nonce is carried forward unchanged into the next stage, not re-minted.
    assert.equal(stage2.csrfNonce, stage1.csrfNonce);

    const code = '317042';
    await insertOtp(user.id, user.email, 'login_verification', code);
    await withTestRequestCookies(cookies, () => redirected(() =>
      verifyLoginOtp({}, form({ code }, stage2.csrfNonce))));
    assert.ok(cookies.get(sessionCookieName()));
  });

  await t.test('a request carrying neither a valid general token nor the real pending nonce still fails closed', async () => {
    await resetIdoc();
    const user = await createUser();
    await sql`update idoc.users set password_hash=${await hashPassword(password)} where id=${user.id}`;
    const cookies = new TestCookies();
    await withTestRequestCookies(cookies, () => startPendingLogin(user.email));
    await assert.rejects(withTestRequestCookies(cookies, () =>
      signIn({}, form({ email: user.email, password }, 'neither-real-value-nor-the-nonce'))));
  });
});

test('AUTH-CSRF-003 signup: the pending-flow-bound csrfNonce is accepted as an alternative to a drifted general CSRF cookie', async (t) => {
  await t.test('verifySignupOtp and completeSignup both succeed on the pending nonce even when the general cookie token is wrong', async () => {
    const email = 'nonce-signup@example.test';
    const cookies = new TestCookies();
    await issueTestCsrfToken(cookies, null);

    const stage1 = await withTestRequestCookies(cookies, async () => {
      await startPendingSignup(email, email);
      return (await getPendingSignup())!;
    });
    assert.ok(stage1.csrfNonce);

    const code = '482913';
    await insertOtp(null, email, 'signup_verification', code);
    await withTestRequestCookies(cookies, () => redirected(() =>
      verifySignupOtp({}, form({ code }, stage1.csrfNonce))));

    const stage2 = await withTestRequestCookies(cookies, getPendingSignup);
    assert.ok(stage2?.verified);
    assert.equal(stage2.csrfNonce, stage1.csrfNonce);

    await withPwnedPasswordsClean(() => withTestRequestCookies(cookies, () => redirected(() =>
      completeSignup({}, form({ password }, stage2.csrfNonce)))));
    const [created] = await sql`select id from idoc.users where email=${email}`;
    assert.ok(created);
  });

  await t.test('a request carrying neither a valid general token nor the real pending nonce still fails closed', async () => {
    await resetIdoc();
    const email = 'nonce-signup-fail@example.test';
    const cookies = new TestCookies();
    await withTestRequestCookies(cookies, () => startPendingSignup(email, email));
    const code = '111222';
    await insertOtp(null, email, 'signup_verification', code);
    await assert.rejects(withTestRequestCookies(cookies, () =>
      verifySignupOtp({}, form({ code }, 'neither-real-value-nor-the-nonce'))));
  });
});

test('AUTH-CSRF-003 password reset: the pending-flow-bound csrfNonce is accepted as an alternative to a drifted general CSRF cookie', async (t) => {
  await t.test('verifyPasswordResetOtp and completePasswordReset both succeed on the pending nonce even when the general cookie token is wrong', async () => {
    const user = await createUser();
    const cookies = new TestCookies();
    await issueTestCsrfToken(cookies, null);

    const stage1 = await withTestRequestCookies(cookies, async () => {
      await startPendingPasswordReset({ email: user.email, stage: 'email-otp', subjectId: user.id });
      return (await getPendingPasswordReset())!;
    });
    assert.ok(stage1.csrfNonce);

    const code = '654321';
    await insertOtp(user.id, user.email, 'password_reset', code);
    await withTestRequestCookies(cookies, () => redirected(() =>
      verifyPasswordResetOtp({}, form({ code }, stage1.csrfNonce))));

    const stage2 = await withTestRequestCookies(cookies, getPendingPasswordReset);
    assert.equal(stage2?.stage, 'authorized');
    assert.equal(stage2.csrfNonce, stage1.csrfNonce);

    await withPwnedPasswordsClean(() => withTestRequestCookies(cookies, () => redirected(() =>
      completePasswordReset({}, form({ password }, stage2.csrfNonce)))));

    const [updated] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
    assert.notEqual(updated.passwordHash, 'fixture-password-hash');
  });

  await t.test('a request carrying neither a valid general token nor the real pending nonce still fails closed', async () => {
    await resetIdoc();
    const user = await createUser();
    const cookies = new TestCookies();
    await withTestRequestCookies(cookies, () =>
      startPendingPasswordReset({ email: user.email, stage: 'email-otp', subjectId: user.id }));
    const code = '999888';
    await insertOtp(user.id, user.email, 'password_reset', code);
    await assert.rejects(withTestRequestCookies(cookies, () =>
      verifyPasswordResetOtp({}, form({ code }, 'neither-real-value-nor-the-nonce'))));
  });
});
