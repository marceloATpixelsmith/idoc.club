import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { hash as hashBcrypt } from 'bcryptjs';
import { signIn } from '../app/(login)/actions.ts';
import { verifyLoginOtp } from '../app/(login)/sign-in/actions.ts';
import { startPendingLogin } from '../lib/auth/pending-login.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { comparePasswords, passwordHashNeedsUpgrade } from '../lib/auth/session.ts';
import { finalizeMigratedAccountAfterVerifiedPassword } from '../lib/membership/account-recovery.ts';
import { createOwnMemberProfile, getOnboardingPrefill } from '../lib/membership/data-access.ts';
import { withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { closeHarness, createUser, profileInput, resetIdoc, sql } from './postgres-harness.ts';

// TEMPORARY legacy import (docs/03 section 11): first sign-in with an imported WordPress password, and onboarding for imported
// profiles that still have blank required fields.
Object.assign(process.env, {
  ACCOUNT_DELIVERY_ENCRYPTION_KEYS: JSON.stringify({ 'test-v1': 'integration-only-key-material-at-least-32-characters' }),
  ACCOUNT_DELIVERY_KEY_VERSION: 'test-v1',
  AUTH_SECRET: 'legacy-first-login-secret-long-enough',
  BASE_URL: 'http://localhost:3000',
  BREVO_API_KEY: 'integration-only-provider-key',
  BREVO_FROM_EMAIL: 'accounts@idoc.club',
  MFA_PENDING_AUTH_SIGNING_KEY: randomBytes(32).toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: randomBytes(32).toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'legacy-first-login',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'legacy-first-login': randomBytes(32).toString('base64url') }),
  RATE_LIMIT_HASH_KEY: 'legacy-first-login-rate-limit-secret',
  REMEMBER_TOTP_DEVICE_ENABLED: 'false',
});

// Published phpass test vector: password "test12345".
const PASSWORD = 'ValidLegacy1!';
const PHPASS = '$P$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0';
const PLACEHOLDER = '!legacy-import-no-password-yet';

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}
const realFetch = globalThis.fetch;
beforeEach(async () => { await resetIdoc(); globalThis.fetch = realFetch; });
after(async () => { globalThis.fetch = realFetch; await closeHarness(); });

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}
async function redirected(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => String(error).includes('NEXT_REDIRECT'));
}

/** An imported member exactly as the legacy import writes one; `complete` false leaves the required profile fields blank. */
async function importedMember(complete: boolean, legacyId = 7) {
  const user = await createUser('migrated_pending');
  const prehash = createHmac('sha384', 'wp-sha384').update(PASSWORD, 'utf8').digest('base64');
  const legacyHash = `$wp${await hashBcrypt(prehash, 4)}`.replace(/^\$wp\$2[ab]\$/, '$wp$2y
  const blank = complete ? { address: '1 Main St', city: 'Town', state: 'ST', postal: '12345', country: 'DE' } : { address: '', city: '', state: '', postal: '', country: '' };
  const [profile] = await sql<{ id: number }[]>`insert into idoc.profiles (user_id, legacy_wp_user_id, first_name, last_name, address_1, city, state_province, postal_code, country_code)
    values (${user.id}, ${legacyId}, 'Ada', 'Lovelace', ${blank.address}, ${blank.city}, ${blank.state}, ${blank.postal}, ${blank.country}) returning id`;
  await sql`insert into idoc.professional_roles (profile_id, role_type, national_federation_country_code, idoc_region, fei_id, official_statuses, is_technical_delegate)
    values (${profile.id}, 'judge', 'DE', 'Western Europe & Africa', '10001', ${['FEI Dressage Judge 1/2**']}, false)`;
  await sql`insert into idoc.memberships (profile_id, status, starts_on, valid_until, source) values (${profile.id}, 'active', '2025-01-01', '2099-12-31', 'migration')`;
  await sql`insert into idoc.migration_map (legacy_type, legacy_id, new_entity_id, disposition, confidence) values ('wp_user', ${String(legacyId)}, ${String(user.id)}, 'imported', 'exact')`;
  return user;
}
async function attemptSignIn(email: string, password: string) {
  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  let result: unknown;
  await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(email);
    try { result = await signIn({}, form({ csrf_token, email, password })); } catch (error) { if (!String(error).includes('NEXT_REDIRECT')) throw error; result = 'redirect'; }
  });
  return result;
}
const stored = async (id: number) => (await sql`select password_hash, legacy_password_hash, legacy_password_format, password_set_at from idoc.users where id=${id}`)[0];

test('the correct WordPress password signs in once and the exported hash is replaced by a current Argon2id hash', async () => {
  globalThis.fetch = (async () => new Response('0000000000000000000000000000000000A:1', { status: 200 })) as typeof fetch;
  const user = await importedMember(true);
  assert.equal(await attemptSignIn(user.email, PASSWORD), 'redirect');
  const row = await stored(user.id);
  assert.match(row.password_hash, /^argon2id\$v=19\$/);
  assert.equal(passwordHashNeedsUpgrade(row.password_hash), false);
  assert.equal(row.legacy_password_hash, null);
  assert.equal(row.legacy_password_format, null);
  assert.ok(row.password_set_at);
  assert.equal(await comparePasswords(PASSWORD, row.password_hash), true);
  // The next sign-in uses the new hash and the member is still routed to the email-verification step.
  assert.equal(await attemptSignIn(user.email, PASSWORD), 'redirect');
});

test('a wrong password changes nothing and keeps the exported hash', async () => {
  const user = await importedMember(true);
  const result = await attemptSignIn(user.email, 'not-the-password');
  assert.deepEqual(result, { error: 'Invalid email or password. Please try again.', email: user.email });
  const row = await stored(user.id);
  assert.equal(row.password_hash, PLACEHOLDER);
  assert.match(row.legacy_password_hash, /^\$wp\$2y\$/);
});

test('a WordPress password found in the breach corpus never signs in; an activation link is queued instead', async () => {
  const suffix = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase().slice(5);
  globalThis.fetch = (async () => new Response(`${suffix}:12345\r\n`, { status: 200 })) as typeof fetch;
  const user = await importedMember(true);
  const result = await attemptSignIn(user.email, PASSWORD) as { error?: string };
  assert.match(String(result.error), /data breach/);
  const row = await stored(user.id);
  assert.equal(row.password_hash, PLACEHOLDER);
  assert.match(row.legacy_password_hash, /^\$wp\$2y\$/);
  assert.equal((await sql`select 1 from idoc.account_delivery_outbox where user_id=${user.id} and purpose='migration_activation'`).length, 1);
});

test('a verified but policy-noncompliant WordPress password requires a reset before account activation', async () => {
  globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch;
  const user = await importedMember(true, 19);
  await sql`update idoc.users set legacy_password_hash=${PHPASS}, legacy_password_format='phpass' where id=${user.id}`;
  const result = await attemptSignIn(user.email, 'test12345') as { error?: string };
  assert.match(String(result.error), /does not meet the new IDOC password requirements/);
  const row = await stored(user.id);
  assert.equal(row.password_hash, PLACEHOLDER);
  assert.equal(row.legacy_password_hash, PHPASS);
  assert.equal((await sql`select 1 from idoc.account_delivery_outbox where user_id=${user.id} and purpose='migration_activation'`).length, 1);
  assert.equal((await sql`select count(*)::int as n from idoc.auth_sessions where user_id=${user.id}`)[0].n, 0);
});

test('activation moves a complete profile to active and an incomplete one to onboarding', async () => {
  const complete = await importedMember(true, 11);
  const incomplete = await importedMember(false, 12);
  assert.equal((await finalizeMigratedAccountAfterVerifiedPassword(complete.id)).status, 'success');
  assert.equal((await finalizeMigratedAccountAfterVerifiedPassword(incomplete.id)).status, 'success');
  const states = await sql`select id, account_state from idoc.users where id in (${complete.id}, ${incomplete.id}) order by id`;
  assert.deepEqual(states.map((row) => row.account_state), ['active', 'onboarding']);
});

test('onboarding completes the imported profile in place and keeps what the import already knew', async () => {
  const user = await importedMember(false, 21);
  await finalizeMigratedAccountAfterVerifiedPassword(user.id);
  const prefill = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => getOnboardingPrefill(user.id));
  assert.equal(prefill?.classification, 'judge');
  assert.equal(prefill?.feiId, '10001');
  assert.equal(prefill?.address1, '');
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(profileInput(), { keepUpdated: false, privacyAccepted: true, termsAccepted: true }));
  const [after] = await sql`select u.account_state, p.legacy_wp_user_id, p.address_1, p.city from idoc.users u join idoc.profiles p on p.user_id = u.id where u.id = ${user.id}`;
  assert.deepEqual({ ...after }, { account_state: 'active', legacy_wp_user_id: 21, address_1: '1 Test Road', city: 'Test City' });
  assert.equal((await sql`select 1 from idoc.profiles where user_id = ${user.id}`).length, 1);
  assert.equal((await sql`select 1 from idoc.professional_roles where profile_id = (select id from idoc.profiles where user_id = ${user.id}) and effective_to is null`).length, 1);
  assert.equal((await sql`select 1 from idoc.onboarding_consents where profile_id = (select id from idoc.profiles where user_id = ${user.id})`).length, 1);
  // A second completion is refused: the account is no longer in onboarding.
  await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(profileInput())));
});

test('the whole first sign-in works end to end: WordPress password, email code, then a session (no "session expired")', async () => {
  globalThis.fetch = (async () => new Response('0000000000000000000000000000000000A:1', { status: 200 })) as typeof fetch;
  const user = await importedMember(true, 31);
  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(user.email);
    await redirected(() => signIn({}, form({ csrf_token, email: user.email, password: PASSWORD })));
    // Replace the emailed code with a known one, as the existing OTP tests do.
    const code = '123456';
    await sql`update idoc.email_otp_codes set code_hash=${createHash('sha256').update(code).digest('hex')} where user_id=${user.id} and purpose='login_verification'`;
    const result = await verifyLoginOtp({}, form({ code, csrf_token })).catch((error: unknown) => (String(error).includes('NEXT_REDIRECT') ? 'redirect' : Promise.reject(error)));
    assert.equal(result, 'redirect', 'a correct code must sign the member in, not report an expired sign-in');
  });
  assert.equal((await sql`select account_state from idoc.users where id=${user.id}`)[0].account_state, 'active');
  assert.equal((await sql`select count(*)::int as n from idoc.auth_sessions where user_id=${user.id} and revoked_at is null`)[0].n, 1);
});
);
  await sql`update idoc.users set password_hash=${PLACEHOLDER}, legacy_password_hash=${legacyHash}, legacy_password_format='wp_bcrypt', email_verified_at=null where id=${user.id}`;
  const blank = complete ? { address: '1 Main St', city: 'Town', state: 'ST', postal: '12345', country: 'DE' } : { address: '', city: '', state: '', postal: '', country: '' };
  const [profile] = await sql<{ id: number }[]>`insert into idoc.profiles (user_id, legacy_wp_user_id, first_name, last_name, address_1, city, state_province, postal_code, country_code)
    values (${user.id}, ${legacyId}, 'Ada', 'Lovelace', ${blank.address}, ${blank.city}, ${blank.state}, ${blank.postal}, ${blank.country}) returning id`;
  await sql`insert into idoc.professional_roles (profile_id, role_type, national_federation_country_code, idoc_region, fei_id, official_statuses, is_technical_delegate)
    values (${profile.id}, 'judge', 'DE', 'Western Europe & Africa', '10001', ${['FEI Dressage Judge 1/2**']}, false)`;
  await sql`insert into idoc.memberships (profile_id, status, starts_on, valid_until, source) values (${profile.id}, 'active', '2025-01-01', '2099-12-31', 'migration')`;
  await sql`insert into idoc.migration_map (legacy_type, legacy_id, new_entity_id, disposition, confidence) values ('wp_user', ${String(legacyId)}, ${String(user.id)}, 'imported', 'exact')`;
  return user;
}
async function attemptSignIn(email: string, password: string) {
  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  let result: unknown;
  await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(email);
    try { result = await signIn({}, form({ csrf_token, email, password })); } catch (error) { if (!String(error).includes('NEXT_REDIRECT')) throw error; result = 'redirect'; }
  });
  return result;
}
const stored = async (id: number) => (await sql`select password_hash, legacy_password_hash, legacy_password_format, password_set_at from idoc.users where id=${id}`)[0];

test('the correct WordPress password signs in once and the exported hash is replaced by a current Argon2id hash', async () => {
  globalThis.fetch = (async () => new Response('0000000000000000000000000000000000A:1', { status: 200 })) as typeof fetch;
  const user = await importedMember(true);
  assert.equal(await attemptSignIn(user.email, PASSWORD), 'redirect');
  const row = await stored(user.id);
  assert.match(row.password_hash, /^argon2id\$v=19\$/);
  assert.equal(passwordHashNeedsUpgrade(row.password_hash), false);
  assert.equal(row.legacy_password_hash, null);
  assert.equal(row.legacy_password_format, null);
  assert.ok(row.password_set_at);
  assert.equal(await comparePasswords(PASSWORD, row.password_hash), true);
  // The next sign-in uses the new hash and the member is still routed to the email-verification step.
  assert.equal(await attemptSignIn(user.email, PASSWORD), 'redirect');
});

test('a wrong password changes nothing and keeps the exported hash', async () => {
  const user = await importedMember(true);
  const result = await attemptSignIn(user.email, 'not-the-password');
  assert.deepEqual(result, { error: 'Invalid email or password. Please try again.', email: user.email });
  const row = await stored(user.id);
  assert.equal(row.password_hash, PLACEHOLDER);
  assert.match(row.legacy_password_hash, /^\$wp\$2y\$/);
});

test('a WordPress password found in the breach corpus never signs in; an activation link is queued instead', async () => {
  const suffix = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase().slice(5);
  globalThis.fetch = (async () => new Response(`${suffix}:12345\r\n`, { status: 200 })) as typeof fetch;
  const user = await importedMember(true);
  const result = await attemptSignIn(user.email, PASSWORD) as { error?: string };
  assert.match(String(result.error), /data breach/);
  const row = await stored(user.id);
  assert.equal(row.password_hash, PLACEHOLDER);
  assert.match(row.legacy_password_hash, /^\$wp\$2y\$/);
  assert.equal((await sql`select 1 from idoc.account_delivery_outbox where user_id=${user.id} and purpose='migration_activation'`).length, 1);
});

test('activation moves a complete profile to active and an incomplete one to onboarding', async () => {
  const complete = await importedMember(true, 11);
  const incomplete = await importedMember(false, 12);
  assert.equal((await finalizeMigratedAccountAfterVerifiedPassword(complete.id)).status, 'success');
  assert.equal((await finalizeMigratedAccountAfterVerifiedPassword(incomplete.id)).status, 'success');
  const states = await sql`select id, account_state from idoc.users where id in (${complete.id}, ${incomplete.id}) order by id`;
  assert.deepEqual(states.map((row) => row.account_state), ['active', 'onboarding']);
});

test('onboarding completes the imported profile in place and keeps what the import already knew', async () => {
  const user = await importedMember(false, 21);
  await finalizeMigratedAccountAfterVerifiedPassword(user.id);
  const prefill = await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => getOnboardingPrefill(user.id));
  assert.equal(prefill?.classification, 'judge');
  assert.equal(prefill?.feiId, '10001');
  assert.equal(prefill?.address1, '');
  await withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(profileInput(), { keepUpdated: false, privacyAccepted: true, termsAccepted: true }));
  const [after] = await sql`select u.account_state, p.legacy_wp_user_id, p.address_1, p.city from idoc.users u join idoc.profiles p on p.user_id = u.id where u.id = ${user.id}`;
  assert.deepEqual({ ...after }, { account_state: 'active', legacy_wp_user_id: 21, address_1: '1 Test Road', city: 'Test City' });
  assert.equal((await sql`select 1 from idoc.profiles where user_id = ${user.id}`).length, 1);
  assert.equal((await sql`select 1 from idoc.professional_roles where profile_id = (select id from idoc.profiles where user_id = ${user.id}) and effective_to is null`).length, 1);
  assert.equal((await sql`select 1 from idoc.onboarding_consents where profile_id = (select id from idoc.profiles where user_id = ${user.id})`).length, 1);
  // A second completion is refused: the account is no longer in onboarding.
  await assert.rejects(withTestMembershipBoundary({ actor: { id: user.id, roles: [] } }, () => createOwnMemberProfile(profileInput())));
});

test('the whole first sign-in works end to end: WordPress password, email code, then a session (no "session expired")', async () => {
  globalThis.fetch = (async () => new Response('0000000000000000000000000000000000A:1', { status: 200 })) as typeof fetch;
  const user = await importedMember(true, 31);
  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(user.email);
    await redirected(() => signIn({}, form({ csrf_token, email: user.email, password: PASSWORD })));
    // Replace the emailed code with a known one, as the existing OTP tests do.
    const code = '123456';
    await sql`update idoc.email_otp_codes set code_hash=${createHash('sha256').update(code).digest('hex')} where user_id=${user.id} and purpose='login_verification'`;
    const result = await verifyLoginOtp({}, form({ code, csrf_token })).catch((error: unknown) => (String(error).includes('NEXT_REDIRECT') ? 'redirect' : Promise.reject(error)));
    assert.equal(result, 'redirect', 'a correct code must sign the member in, not report an expired sign-in');
  });
  assert.equal((await sql`select account_state from idoc.users where id=${user.id}`)[0].account_state, 'active');
  assert.equal((await sql`select count(*)::int as n from idoc.auth_sessions where user_id=${user.id} and revoked_at is null`)[0].n, 1);
});
