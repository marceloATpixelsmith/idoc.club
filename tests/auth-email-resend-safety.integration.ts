import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { resendSignupOtp, verifySignupOtp } from '../app/(login)/sign-up/actions.ts';
import { markPendingSignupVerified, startPendingSignup } from '../lib/auth/pending-signup.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { issueEmailOtp } from '../lib/auth/email-otp.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// AUTH-EMAIL-002: "Resend MUST be throttled and replace or invalidate superseded outstanding
// evidence so prior verification artifacts cannot remain valid indefinitely, while public behavior
// remains enumeration-resistant." Drives the real production resendSignupOtp Server Action -- not a
// parallel helper -- proving the cooldown is actually enforced, a resent code actually supersedes
// (invalidates) the one it replaces rather than merely adding a second valid code, and the
// response shape never varies with facts an anonymous caller shouldn't be able to learn.

Object.assign(process.env, {
  AUTH_SECRET: 'integration-auth-secret-that-is-long-enough',
  BASE_URL: 'http://localhost:3000',
  BREVO_API_KEY: 'integration-only-provider-key',
  BREVO_FROM_EMAIL: 'accounts@idoc.club',
  RATE_LIMIT_HASH_KEY: 'integration-rate-limit-secret-is-long-enough',
});

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}

const originalFetch = globalThis.fetch;
let capturedCode = '';
beforeEach(async () => {
  await resetIdoc();
  capturedCode = '';
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://api.brevo.com/v3/smtp/email') {
      const body = JSON.parse(String(init?.body));
      // Matches only rendered text content between tags (the emailCode() div's `>123456</div>`),
      // never a CSS hex color value like `#111827` inside a style attribute.
      const match = String(body.htmlContent).match(/>(\d{6})</);
      capturedCode = match ? match[1] : '';
      return new Response('{"messageId":"<test@smtp-relay.brevo.com>"}', { status: 201 });
    }
    return originalFetch(input, init);
  };
});
after(async () => { globalThis.fetch = originalFetch; await closeHarness(); });

async function pendingSignupSession(email: string) {
  const cookies = new TestCookies();
  const csrfToken = await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, async () => {
    await startPendingSignup(email, email);
    await markPendingSignupVerified(email, email);
  });
  return { cookies, csrfToken };
}

test('resendSignupOtp enforces the resend cooldown against the real production path', async () => {
  const { cookies, csrfToken } = await pendingSignupSession('cooldown-test@example.test');

  await withTestRequestCookies(cookies, async () => {
    const first = new FormData(); first.set('csrf_token', csrfToken);
    assert.deepEqual(await resendSignupOtp({}, first), { success: 'A new code was sent.' });

    const second = new FormData(); second.set('csrf_token', csrfToken);
    assert.deepEqual(await resendSignupOtp({}, second), { error: 'Please wait before requesting another code.' });
  });

  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.email_otp_codes
    where email='cooldown-test@example.test' and purpose='signup_verification'`;
  assert.equal(count, 1, 'a cooldown-blocked resend must not create a second code row');
});

test('a resent code supersedes (invalidates) the one it replaces, rather than leaving both valid', async () => {
  const email = 'supersede-test@example.test';
  const { cookies, csrfToken } = await pendingSignupSession(email);

  const firstIssue = await issueEmailOtp(email, 'signup_verification');
  assert.equal(firstIssue.status, 'ok');
  const oldCode = capturedCode;
  assert.ok(oldCode);

  // Backdate the just-issued code past the cooldown window so the next resend is a genuine
  // production resend, not one blocked by the cooldown this same control also requires.
  await sql`update idoc.email_otp_codes set created_at = now() - interval '31 seconds'
    where email=${email} and purpose='signup_verification'`;

  await withTestRequestCookies(cookies, async () => {
    const resend = new FormData(); resend.set('csrf_token', csrfToken);
    assert.deepEqual(await resendSignupOtp({}, resend), { success: 'A new code was sent.' });
  });
  const newCode = capturedCode;
  assert.ok(newCode);
  assert.notEqual(newCode, oldCode, 'sanity check: the resend must actually generate a different code');

  await withTestRequestCookies(cookies, async () => {
    const oldAttempt = new FormData(); oldAttempt.set('code', oldCode); oldAttempt.set('csrf_token', csrfToken);
    assert.deepEqual(await verifySignupOtp({}, oldAttempt), { error: 'That code is incorrect.' }, 'the superseded code must no longer verify');
  });

  const [{ count: liveCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.email_otp_codes
    where email=${email} and purpose='signup_verification' and consumed_at is null`;
  assert.equal(liveCount, 1, 'exactly one live (unconsumed) code must exist after a resend');
});

test('resendSignupOtp reports an identical response shape whether or not the pending address happens to already belong to an existing account', async () => {
  const existing = await createUser();
  const freshEmail = 'no-account-yet@example.test';

  const withExistingAccount = await pendingSignupSession(existing.email);
  const withoutAccount = await pendingSignupSession(freshEmail);

  const resultWithAccount = await withTestRequestCookies(withExistingAccount.cookies, async () => {
    const form = new FormData(); form.set('csrf_token', withExistingAccount.csrfToken);
    return resendSignupOtp({}, form);
  });
  const resultWithoutAccount = await withTestRequestCookies(withoutAccount.cookies, async () => {
    const form = new FormData(); form.set('csrf_token', withoutAccount.csrfToken);
    return resendSignupOtp({}, form);
  });

  assert.deepEqual(resultWithAccount, { success: 'A new code was sent.' });
  assert.deepEqual(resultWithoutAccount, { success: 'A new code was sent.' });
  assert.deepEqual(Object.keys(resultWithAccount).sort(), Object.keys(resultWithoutAccount).sort());
});
