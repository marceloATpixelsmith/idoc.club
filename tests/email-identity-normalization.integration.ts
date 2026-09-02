import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { completeSignup } from '../app/(login)/sign-up/actions.ts';
import { markPendingSignupVerified, startPendingSignup } from '../lib/auth/pending-signup.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { emailDisplayForm, normalizeEmail } from '../lib/membership/validation.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { closeHarness, resetIdoc, sql } from './postgres-harness.ts';

// AUTH-IDENTITY-003: "Trusted server code MUST trim surrounding email whitespace, apply
// deterministic Unicode-aware case-insensitive comparison, preserve a display form where useful,
// and enforce uniqueness on the normalized identity without globally stripping dots, plus-tags, or
// applying provider-specific rewriting." Drives the real completeSignup Server Action end to end
// against a real Postgres row -- not a parallel helper -- proving the two properties docs/22 flagged
// as missing: a member's own display casing survives to storage, and uniqueness still collapses
// case/whitespace variants of the same address onto one identity.

Object.assign(process.env, {
  AUTH_SECRET: 'integration-auth-secret-that-is-long-enough',
  BASE_URL: 'http://localhost:3000',
  RATE_LIMIT_HASH_KEY: 'integration-rate-limit-secret-is-long-enough',
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
    if (url.startsWith('https://api.pwnedpasswords.com/range/')) return new Response('', { status: 200 });
    return originalFetch(input, init);
  };
});
after(async () => { globalThis.fetch = originalFetch; await closeHarness(); });

async function redirected(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => String(error).includes('NEXT_REDIRECT'));
}

/** Real production sequence a browser drives: startSignup normalizes+stores the pending cookie,
 * OTP verification marks it verified, then completeSignup creates the row. This helper reproduces
 * exactly that server-side state transition (bypassing only Turnstile/OTP delivery, as every other
 * signup integration test in this suite does) so completeSignup runs unmodified. */
async function completeRealSignup(cookies: TestCookies, csrfToken: string, rawEmail: string, password: string) {
  const email = normalizeEmail(rawEmail);
  const emailDisplay = emailDisplayForm(rawEmail);
  await startPendingSignup(email, emailDisplay);
  await markPendingSignupVerified(email, emailDisplay);
  const form = new FormData();
  form.set('password', password);
  form.set('csrf_token', csrfToken);
  return completeSignup({}, form);
}

test('signup preserves the submitted display-form casing for storage while the normalized identity governs uniqueness', async () => {
  const password = 'Correct Horse Battery Staple 42!';
  const rawEmail = '  John.Doe+School@ExAmple.TEST  ';
  const cookies = new TestCookies();
  const csrfToken = await issueTestCsrfToken(cookies, null);

  await withTestRequestCookies(cookies, async () => {
    await redirected(() => completeRealSignup(cookies, csrfToken, rawEmail, password));
  });

  const [created] = await sql`select email, email_display from idoc.users where email='john.doe+school@example.test'`;
  assert.ok(created, 'the normalized (trimmed, lowercased) address must be what identity/uniqueness is keyed on');
  // Dots and plus-tags are preserved verbatim in both forms -- the canonical requirement forbids
  // globally stripping either.
  assert.equal(created.email, 'john.doe+school@example.test');
  assert.equal(created.email_display, 'John.Doe+School@ExAmple.TEST', 'the display form must retain the exact casing the member typed, trimmed only');
});

test('a second signup with only a different case/whitespace variant of an already-registered address is rejected as a duplicate, not created as a second identity', async () => {
  const password = 'Correct Horse Battery Staple 42!';
  const cookies1 = new TestCookies();
  const csrfToken1 = await issueTestCsrfToken(cookies1, null);
  await withTestRequestCookies(cookies1, async () => {
    await redirected(() => completeRealSignup(cookies1, csrfToken1, 'collide@example.test', password));
  });

  const cookies2 = new TestCookies();
  const csrfToken2 = await issueTestCsrfToken(cookies2, null);
  await withTestRequestCookies(cookies2, async () => {
    const result = await completeRealSignup(cookies2, csrfToken2, '  Collide@Example.TEST  ', password);
    assert.deepEqual(result, { error: 'An account with this email already exists. Sign in instead.' });
  });

  assert.equal((await sql`select count(*)::int count from idoc.users where email='collide@example.test'`)[0].count, 1);
});

test('normalizeEmail and emailDisplayForm both trim surrounding whitespace and never strip dots or plus-tags', () => {
  assert.equal(normalizeEmail('  Jane.Q+Tag@Example.COM  '), 'jane.q+tag@example.com');
  assert.equal(emailDisplayForm('  Jane.Q+Tag@Example.COM  '), 'Jane.Q+Tag@Example.COM');
});
