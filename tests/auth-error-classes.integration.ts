import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { verifyLoginOtp } from '../app/(login)/sign-in/actions.ts';
import { requireLoginOtp } from '../lib/auth/pending-login.ts';
import { generatePendingCsrfNonce } from '../lib/security/csrf.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { supportEmailForServer } from '../lib/runtime/configuration.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// AUTH-ERROR-001: "User-correctable errors MAY be specific subject to enumeration rules; persistent
// system failures MUST use the canonical generic support message." Drives the real production
// verifyLoginOtp Server Action -- not a parallel helper -- through both branches: a genuinely
// persistent system failure (a migrated account whose imported foundation record is missing, so
// finalizeMigratedAccountAfterVerifiedPassword can never succeed no matter how many times it's
// retried) must surface the canonical generic support message, while an ordinary user-correctable
// mistake (a wrong OTP code) keeps its specific, actionable, enumeration-safe message.

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

beforeEach(resetIdoc);
after(closeHarness);

async function insertLoginOtp(userId: number, email: string, code: string) {
  await sql`insert into idoc.email_otp_codes(user_id,email,purpose,code_hash,expires_at)
    values(${userId},${email},'login_verification',${createHash('sha256').update(code).digest('hex')},now()+interval '10 minutes')`;
}

test('a persistent system failure (a migrated account with no imported foundation record) surfaces the canonical generic support message, not an internal detail', async () => {
  // migrated_pending with no idoc.profiles row: validateMigrationActivationFoundation can never
  // succeed for this account -- a genuine, permanent foundation defect, not a transient hiccup.
  const user = await createUser('migrated_pending');
  const code = '482913';
  const cookies = new TestCookies();
  const csrfToken = await issueTestCsrfToken(cookies, null);

  await withTestRequestCookies(cookies, async () => {
    await requireLoginOtp(user.email, user.id, 0, false, generatePendingCsrfNonce());
    await insertLoginOtp(user.id, user.email, code);
    const form = new FormData();
    form.set('code', code);
    form.set('csrf_token', csrfToken);
    const result = await verifyLoginOtp({}, form);
    assert.deepEqual(result, { error: `We could not finish signing you in automatically. Contact ${supportEmailForServer()} for help.` });
  });

  // Never silently promotes the account despite the failure.
  const [row] = await sql`select account_state from idoc.users where id=${user.id}`;
  assert.equal(row.account_state, 'migrated_pending');
});

test('a user-correctable mistake (a wrong OTP code) keeps its specific, actionable message rather than being generic-ized', async () => {
  const user = await createUser('active');
  const code = '482913';
  const cookies = new TestCookies();
  const csrfToken = await issueTestCsrfToken(cookies, null);

  await withTestRequestCookies(cookies, async () => {
    await requireLoginOtp(user.email, user.id, 0, false, generatePendingCsrfNonce());
    await insertLoginOtp(user.id, user.email, code);
    const form = new FormData();
    form.set('code', '000000');
    form.set('csrf_token', csrfToken);
    const result = await verifyLoginOtp({}, form);
    assert.deepEqual(result, { error: 'That code is incorrect.' });
  });
});
