import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { signIn } from '../app/(login)/actions.ts';
import { completePasswordReset, resendPasswordResetOtp, startPasswordReset, verifyPasswordResetOtp } from '../app/(login)/recover-password/actions.ts';
import { startPendingLogin } from '../lib/auth/pending-login.ts';
import { MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { beginTotpEnrollment, completeTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import { getPendingPrimaryAuth } from '../lib/auth/mfa/pending-primary-auth.ts';
import { getPendingPasswordReset } from '../lib/auth/pending-password-reset.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { comparePasswords } from '../lib/auth/session.ts';
import { consumeAccountToken } from '../lib/membership/account-recovery.ts';
import { decryptDeliveryPayload } from '../lib/security/encrypted-payload.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// Imported (legacy) members hold no usable password, so "Forgot password" must send them the activation link that
// sets their first password. Before this, /recover-password silently sent nothing to a `migrated_pending` account.
const totpKey = randomBytes(32);
Object.assign(process.env, {
  ACCOUNT_DELIVERY_ENCRYPTION_KEYS: JSON.stringify({ 'test-v1': 'integration-only-key-material-at-least-32-characters' }),
  ACCOUNT_DELIVERY_KEY_VERSION: 'test-v1',
  AUTH_SECRET: 'migrated-password-reset-secret-long-enough',
  BASE_URL: 'http://localhost:3000',
  BREVO_API_KEY: 'integration-only-provider-key',
  BREVO_FROM_EMAIL: 'accounts@idoc.club',
  MFA_PENDING_AUTH_SIGNING_KEY: randomBytes(32).toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: randomBytes(32).toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'migrated-password-reset',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'migrated-password-reset': totpKey.toString('base64url') }),
  RATE_LIMIT_HASH_KEY: 'migrated-password-reset-rate-limit-secret',
  REMEMBER_TOTP_DEVICE_ENABLED: 'false',
  TURNSTILE_SECRET_KEY: 'integration-only-turnstile-secret',
});

const PLACEHOLDER = '!legacy-import-no-password-yet';
const NEW_PASSWORD = 'Brand-New-Passw0rd!x';

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
}
const realFetch = globalThis.fetch;
beforeEach(async () => {
  await resetIdoc();
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => String(input).includes('challenges.cloudflare.com')
    ? Response.json({ action: 'password-reset', hostname: 'localhost', success: true })
    : Response.json({ messageId: 'test' })) as typeof fetch;
});
after(async () => { globalThis.fetch = realFetch; await closeHarness(); });

/** An imported member exactly as the legacy import writes one: placeholder password, unverified, complete profile. */
async function importedMember(legacyId: number) {
  const user = await createUser('migrated_pending');
  await sql`update idoc.users set password_hash=${PLACEHOLDER}, email_verified_at=null where id=${user.id}`;
  const [profile] = await sql<{ id: number }[]>`insert into idoc.profiles (user_id, legacy_wp_user_id, first_name, last_name, address_1, city, state_province, postal_code, country_code)
    values (${user.id}, ${legacyId}, 'Ada', 'Lovelace', '1 Main St', 'Town', 'ST', '12345', 'DE') returning id`;
  await sql`insert into idoc.professional_roles (profile_id, role_type, national_federation_country_code, idoc_region, fei_id, official_statuses, is_technical_delegate)
    values (${profile.id}, 'judge', 'DE', 'Western Europe & Africa', '10001', ${['FEI Dressage Judge 1/2**']}, false)`;
  await sql`insert into idoc.memberships (profile_id, status, starts_on, valid_until, source) values (${profile.id}, 'active', '2025-01-01', '2099-12-31', 'migration')`;
  await sql`insert into idoc.migration_map (legacy_type, legacy_id, new_entity_id, disposition, confidence) values ('wp_user', ${String(legacyId)}, ${String(user.id)}, 'imported', 'exact')`;
  return user;
}

/** Submits the anonymous "Reset your password" form and returns the neutral pending step it leaves behind. */
async function submitReset(email: string) {
  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  const data = new FormData();
  data.set('csrf_token', csrf_token);
  data.set('email', email);
  data.set('turnstileToken', 'XXXX.DUMMY.TOKEN.XXXX');
  return withTestRequestCookies(cookies, async () => {
    await assert.rejects(() => startPasswordReset({}, data), (error: unknown) => String(error).includes('NEXT_REDIRECT'));
    return getPendingPasswordReset();
  });
}

/** Presses Resend on the verification screen left behind by `submitReset`, using that screen's own pending nonce. */
async function pressResend(email: string) {
  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  const start = new FormData();
  start.set('csrf_token', csrf_token);
  start.set('email', email);
  start.set('turnstileToken', 'XXXX.DUMMY.TOKEN.XXXX');
  return withTestRequestCookies(cookies, async () => {
    await assert.rejects(() => startPasswordReset({}, start), (error: unknown) => String(error).includes('NEXT_REDIRECT'));
    const pending = await getPendingPasswordReset();
    assert.ok(pending?.csrfNonce);
    const resend = new FormData();
    resend.set('csrf_token', pending.csrfNonce);
    return resendPasswordResetOtp({}, resend);
  });
}

const queued = async (userId: number, purpose: string) => (await sql<{ encrypted_payload: string; key_version: string }[]>`
  select encrypted_payload,key_version from idoc.account_delivery_outbox where user_id=${userId} and purpose=${purpose}`);
const otpCount = async (userId: number) => (await sql`select count(*)::int as n from idoc.email_otp_codes where user_id=${userId}`)[0].n as number;

test('an ordinary imported member who asks to reset their password is sent the activation link, and the link activates the account', async () => {
  const user = await importedMember(21);
  const pending = await submitReset(user.email);
  assert.equal(pending?.stage, 'email-otp');
  assert.equal(pending && 'subjectId' in pending ? pending.subjectId : undefined, undefined, 'the screen must not reveal that the account exists');

  const outbox = await queued(user.id, 'migration_activation');
  assert.equal(outbox.length, 1);
  assert.equal((await sql`select count(*)::int as n from idoc.account_tokens where user_id=${user.id} and purpose='migration_activation'`)[0].n, 1);
  assert.equal(await otpCount(user.id), 0, 'an imported member is sent a link, not a reset code');

  const raw = decryptDeliveryPayload(outbox[0].encrypted_payload, outbox[0].key_version).token;
  const consumed = await consumeAccountToken(raw, 'migration_activation', NEW_PASSWORD);
  assert.equal(consumed.status, 'success');
  const [row] = await sql<{ account_state: string; email_verified_at: Date | null; password_hash: string }[]>`
    select account_state,email_verified_at,password_hash from idoc.users where id=${user.id}`;
  assert.equal(row.account_state, 'active');
  assert.ok(row.email_verified_at);
  assert.equal(await comparePasswords(NEW_PASSWORD, row.password_hash), true);
  assert.equal((await consumeAccountToken(raw, 'migration_activation', NEW_PASSWORD)).status, 'invalid', 'the link is single-use');
});

test('an imported member who also holds an administrator grant is sent the same activation link', async () => {
  const user = await importedMember(22);
  const admin = await createUser('active');
  await sql`insert into idoc.application_roles (user_id, role, granted_by) values (${user.id}, 'administrator', ${admin.id})`;
  const pending = await submitReset(user.email);
  assert.equal(pending?.stage, 'email-otp');
  assert.equal((await queued(user.id, 'migration_activation')).length, 1);
});

test('an active member keeps the emailed reset code and receives no activation link', async () => {
  const user = await createUser('active');
  const pending = await submitReset(user.email);
  assert.equal(pending?.stage, 'email-otp');
  assert.equal(await otpCount(user.id), 1);
  assert.equal((await queued(user.id, 'migration_activation')).length, 0);
});

test('unknown and ineligible emails get the identical neutral screen and nothing is sent', async () => {
  const suspended = await createUser('suspended');
  const unknown = await submitReset('nobody-at-all@example.test');
  const ineligible = await submitReset(suspended.email);
  assert.equal(unknown?.stage, 'email-otp');
  assert.equal(ineligible?.stage, 'email-otp');
  assert.equal((await sql`select count(*)::int as n from idoc.account_delivery_outbox`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from idoc.email_otp_codes`)[0].n, 0);
});

test('Resend on the verification screen queues a fresh activation link for an imported member and stays neutral for everyone else', async () => {
  const imported = await importedMember(23);
  const active = await createUser('active');
  const neutral = { success: 'If email verification is available for this account, a new code was sent.' };

  assert.deepEqual(await pressResend(imported.email), neutral);
  assert.equal((await queued(imported.id, 'migration_activation')).length, 2, 'the initial send plus the resend');
  assert.equal(await otpCount(imported.id), 0);

  assert.deepEqual(await pressResend(active.email), neutral);
  assert.equal((await queued(active.id, 'migration_activation')).length, 0);
  assert.deepEqual(await pressResend('nobody-at-all@example.test'), neutral);
  assert.equal((await sql`select count(*)::int as n from idoc.account_delivery_outbox where user_id is distinct from ${imported.id}`)[0].n, 0);
});

test('an imported member with an administrator grant can go from Forgot password to the forced authenticator setup with no operator help', async () => {
  const user = await importedMember(24);
  const grantor = await createUser('active');
  await sql`insert into idoc.application_roles (user_id, role, granted_by) values (${user.id}, 'administrator', ${grantor.id})`;

  await submitReset(user.email);
  const [outbox] = await queued(user.id, 'migration_activation');
  const raw = decryptDeliveryPayload(outbox.encrypted_payload, outbox.key_version).token;
  assert.equal((await consumeAccountToken(raw, 'migration_activation', NEW_PASSWORD)).status, 'success');

  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  const login = new FormData();
  login.set('csrf_token', csrf_token);
  login.set('email', user.email);
  login.set('password', NEW_PASSWORD);
  const outcome = await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(user.email);
    let redirectedTo = '';
    try { await signIn({}, login); } catch (error) {
      assert.ok(String(error).includes('NEXT_REDIRECT'), String(error));
      redirectedTo = String((error as { digest?: string }).digest ?? error);
    }
    return { pending: await getPendingPrimaryAuth(), redirectedTo };
  });
  assert.match(outcome.redirectedTo, /\/mfa/, 'the administrator is sent to the authenticator step, not signed in');
  assert.equal(outcome.pending?.stage, 'enrollment', 'with no authenticator on file, setup is forced');
  assert.equal((await sql`select count(*)::int as n from idoc.auth_sessions where user_id=${user.id}`)[0].n, 0, 'no session exists until setup is finished');
});

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
  const store = new PostgresMfaStore(sql);
  const nowMs = Date.now() - 30_000;
  const enrollment = await beginTotpEnrollment({ accountLabel: user.email, applicationId: MFA_APPLICATION_ID,
    encryptionKey: totpKey, issuer: 'IDOC', keyId: 'migrated-password-reset', nowMs, store, subjectId: String(user.id) });
  const secret = new URL(enrollment.provisioningUri).searchParams.get('secret')!;
  const result = await completeTotpEnrollment({ applicationId: MFA_APPLICATION_ID,
    code: generateTotpCode(secret, nowMs), factorId: enrollment.factorId, nowMs,
    resolveKey: () => totpKey, store, subjectId: String(user.id), transactionId: enrollment.transactionId });
  assert.equal(result.status, 'activated');
}

test('an administrator who never set up an authenticator can reset by emailed code, and must then set one up to sign in', async () => {
  const admin = await createUser('active');
  await sql`insert into idoc.application_roles (user_id, role, granted_by) values (${admin.id}, 'administrator', ${admin.id})`;
  const nonce = new TestCookies();
  const csrf_token = await issueTestCsrfToken(nonce, null);
  const start = new FormData();
  start.set('csrf_token', csrf_token);
  start.set('email', admin.email);
  start.set('turnstileToken', 'XXXX.DUMMY.TOKEN.XXXX');
  const code = '317042';
  await withTestRequestCookies(nonce, async () => {
    await assert.rejects(() => startPasswordReset({}, start), (error: unknown) => String(error).includes('NEXT_REDIRECT'));
    assert.equal((await getPendingPasswordReset())?.stage, 'email-otp', 'no authenticator means the emailed-code path, not a dead end');
    assert.equal(await otpCount(admin.id), 1);
    await sql`update idoc.email_otp_codes set code_hash=${createHash('sha256').update(code).digest('hex')} where user_id=${admin.id}`;

    const wrong = new FormData(); wrong.set('csrf_token', csrf_token); wrong.set('code', '000000');
    assert.deepEqual(await verifyPasswordResetOtp({}, wrong), { error: 'That verification code is incorrect or expired.' });
    const good = new FormData(); good.set('csrf_token', csrf_token); good.set('code', code);
    await assert.rejects(() => verifyPasswordResetOtp({}, good), (error: unknown) => String(error).includes('NEXT_REDIRECT'));
    assert.equal((await getPendingPasswordReset())?.stage, 'authorized');

    const finish = new FormData(); finish.set('csrf_token', csrf_token); finish.set('password', NEW_PASSWORD);
    await assert.rejects(() => completePasswordReset({}, finish), (error: unknown) => String(error).includes('NEXT_REDIRECT'));
  });
  const [row] = await sql<{ password_hash: string; session_version: number }[]>`select password_hash, session_version from idoc.users where id=${admin.id}`;
  assert.equal(await comparePasswords(NEW_PASSWORD, row.password_hash), true);
  assert.ok(row.session_version >= 1, 'prior sessions are revoked');

  const login = new TestCookies();
  const loginCsrf = await issueTestCsrfToken(login, null);
  const form = new FormData();
  form.set('csrf_token', loginCsrf); form.set('email', admin.email); form.set('password', NEW_PASSWORD);
  const pending = await withTestRequestCookies(login, async () => {
    await startPendingLogin(admin.email);
    await assert.rejects(() => signIn({}, form), (error: unknown) => String(error).includes('NEXT_REDIRECT'));
    return getPendingPrimaryAuth();
  });
  assert.equal(pending?.stage, 'enrollment', 'the first sign-in after the reset forces authenticator setup');
  assert.equal((await sql`select count(*)::int as n from idoc.auth_sessions where user_id=${admin.id}`)[0].n, 0);
});

test('an administrator who HAS an authenticator still cannot use an emailed code to reset', async () => {
  const admin = await createUser('active');
  await sql`insert into idoc.application_roles (user_id, role, granted_by) values (${admin.id}, 'administrator', ${admin.id})`;
  await activeTotpFactor(admin);
  const pending = await submitReset(admin.email);
  assert.equal(pending?.stage, 'totp');
  assert.equal(await otpCount(admin.id), 0, 'no emailed code exists to be used');
});
