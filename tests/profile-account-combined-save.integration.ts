import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { eq } from 'drizzle-orm';
import { saveOwnAccountAndProfileForm } from '../app/(dashboard)/account/actions.ts';
import { hashPassword } from '../lib/auth/password-hash.ts';
import { setSession } from '../lib/auth/session.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { db } from '../lib/db/drizzle.ts';
import { users } from '../lib/db/schema.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { csrfCookieName } from '../lib/security/csrf-tokens.ts';
import { closeHarness, createCompleteGraph, createUser, judgeRole, profileInput, resetIdoc, sql } from './postgres-harness.ts';

// My Profile's single Save button submits one combined FormData to saveOwnAccountAndProfileForm
// (app/(dashboard)/account/actions.ts), which composes the existing updateAccount (email, MFA-gated
// only when it genuinely changes) with the existing profile-save logic. Two real Codex review
// findings on that composition, proven here against a real Postgres row rather than a mock:
// 1. An invalid profile must never let the email half run first -- that would send a real
//    verification email (and, for a privileged actor, consume fresh MFA authority) for a save that
//    ultimately fails.
// 2. When the email genuinely changes, the login itself does not change until the member follows
//    the verification link -- the combined success message must say so, never a generic "updated"
//    that reads as already complete.

Object.assign(process.env, {
  AUTH_SECRET: 'integration-auth-secret-that-is-long-enough',
  BASE_URL: 'https://idoc.club',
  BREVO_API_KEY: 'integration-only-provider-key',
  BREVO_FROM_EMAIL: 'accounts@idoc.club',
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
  globalThis.fetch = async () => new Response('{"messageId":"<test@smtp-relay.brevo.com>"}', { status: 201 });
});
after(async () => { globalThis.fetch = originalFetch; await closeHarness(); });

function profileFormData(email: string) {
  const base = profileInput([judgeRole]);
  const form = new FormData();
  form.set('email', email);
  form.set('classification', 'judge');
  form.set('firstName', base.firstName);
  form.set('lastName', base.lastName);
  form.set('address1', base.address1);
  form.set('address2', base.address2);
  form.set('city', base.city);
  form.set('stateProvince', base.stateProvince);
  form.set('postalCode', base.postalCode);
  form.set('countryCode', base.countryCode);
  form.set('nationalFederationCountryCode', judgeRole.nationalFederationCountryCode);
  form.set('idocRegion', judgeRole.idocRegion);
  form.set('feiId', judgeRole.feiId);
  form.set('isTechnicalDelegate', judgeRole.isTechnicalDelegate ? 'yes' : 'no');
  for (const status of judgeRole.officialStatuses) form.append('judgeStatus', status);
  return form;
}

async function withRealSession<T>(userId: number, run: (form: FormData) => Promise<T>): Promise<T> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const cookies = new TestCookies();
  return withTestRequestCookies(cookies, () => withTestMembershipBoundary({ actor: { id: userId, roles: [] } }, async () => {
    await setSession(user);
    const csrfToken = cookies.get(csrfCookieName())?.value ?? '';
    const form = profileFormData(user.email);
    form.set('csrf_token', csrfToken);
    return run(form);
  }));
}

test('a valid profile-only save (email unchanged) updates the profile and never issues an email verification', async () => {
  const { user, profile } = await createCompleteGraph();
  const result = await withRealSession(user.id, async (form) => {
    form.set('city', 'A New City');
    return saveOwnAccountAndProfileForm({}, form);
  });
  assert.deepEqual(result, { success: 'Your account and profile were updated.' });
  const [row] = await sql`select city from idoc.profiles where id=${profile.id}`;
  assert.equal(row.city, 'A New City');
  assert.equal((await sql`select count(*)::int as count from idoc.email_verification_tokens where user_id=${user.id} and consumed_at is null`)[0].count, 0);
});

const CURRENT_PASSWORD = 'Current-Password-For-Tests-2026!';
async function givePassword(userId: number) {
  const hash = await hashPassword(CURRENT_PASSWORD);
  await sql`update idoc.users set password_hash=${hash}, password_set_at=now() where id=${userId}`;
}

// Pentest 2026-10-27, finding 1: a session alone must not be able to change the login email (which is also where the password-reset
// and sign-in codes go), because members have no authenticator for the step-up to ask for.
test('changing the login email requires the current password, checked before anything is issued or any address is probed', async () => {
  const { user } = await createCompleteGraph();
  await givePassword(user.id);
  const attempt = (password: string | null, email = 'changed@example.test') => withRealSession(user.id, async (form) => {
    form.set('email', email);
    if (password !== null) form.set('currentPassword', password);
    return saveOwnAccountAndProfileForm({}, form);
  });
  assert.deepEqual(await attempt(null), { error: 'Enter your current password to change your login email.' });
  assert.deepEqual(await attempt('wrong-password-123'), { error: 'Current password is incorrect.' });
  // The duplicate check must not answer a caller that has not proved the password: the same refusal either way.
  const other = await createUser();
  const [taken] = await sql`select email from idoc.users where id=${other.id}`;
  assert.deepEqual(await attempt('wrong-password-123', taken.email), { error: 'Current password is incorrect.' });
  assert.equal((await sql`select count(*)::int as count from idoc.email_verification_tokens where user_id=${user.id}`)[0].count, 0, 'no verification mail is ever issued without the password');
});

test('an account with no password (Google-only) cannot change its login email until one is set', async () => {
  const { user } = await createCompleteGraph();
  await sql`update idoc.users set password_set_at=null where id=${user.id}`;
  const result = await withRealSession(user.id, async (form) => {
    form.set('email', 'changed@example.test');
    form.set('currentPassword', 'anything-at-all-123');
    return saveOwnAccountAndProfileForm({}, form);
  });
  assert.deepEqual(result, { error: 'Set a password under Security before changing your login email, or contact support.' });
  assert.equal((await sql`select count(*)::int as count from idoc.email_verification_tokens where user_id=${user.id}`)[0].count, 0);
});

test('changing the email together with a valid profile save updates the profile immediately, leaves the login email pending verification, and says so', async () => {
  const { user, profile } = await createCompleteGraph();
  await givePassword(user.id);
  const [before] = await sql`select email from idoc.users where id=${user.id}`;
  const result = await withRealSession(user.id, async (form) => {
    form.set('email', 'changed@example.test');
    form.set('currentPassword', CURRENT_PASSWORD);
    form.set('city', 'A New City');
    return saveOwnAccountAndProfileForm({}, form);
  });
  assert.deepEqual(result, { success: 'Your profile was updated. Check your new email address to verify the change.' });
  const [row] = await sql`select city from idoc.profiles where id=${profile.id}`;
  assert.equal(row.city, 'A New City', 'the profile half must not be skipped just because the email also changed');
  const [account] = await sql`select email from idoc.users where id=${user.id}`;
  assert.equal(account.email, before.email, 'the login identity must not change until the verification link is followed');
  const [pending] = await sql`select pending_email from idoc.email_verification_tokens where user_id=${user.id} and consumed_at is null`;
  assert.equal(pending?.pending_email, 'changed@example.test');
});

test('an invalid profile submitted alongside a new email is rejected before any verification email is sent', async () => {
  const { user, profile } = await createCompleteGraph();
  const [beforeProfile] = await sql`select city from idoc.profiles where id=${profile.id}`;
  await givePassword(user.id);
  const result = await withRealSession(user.id, async (form) => {
    form.set('email', 'changed@example.test');
    form.set('currentPassword', CURRENT_PASSWORD);
    form.set('city', 'A New City');
    // Clear every Judge status checkbox -- the HTML form permits this, but memberProfileSchema
    // requires at least one for a judge role. Exactly the Codex-cited scenario.
    form.delete('judgeStatus');
    return saveOwnAccountAndProfileForm({}, form);
  });
  assert.deepEqual(result, { error: 'Review the highlighted profile fields.' });
  const [afterProfile] = await sql`select city from idoc.profiles where id=${profile.id}`;
  assert.equal(afterProfile.city, beforeProfile.city, 'a failed combined save must leave the profile untouched');
  assert.equal(
    (await sql`select count(*)::int as count from idoc.email_verification_tokens where user_id=${user.id}`)[0].count,
    0,
    'the email half must never run -- no verification token, pending or otherwise -- when the profile half is invalid',
  );
});
