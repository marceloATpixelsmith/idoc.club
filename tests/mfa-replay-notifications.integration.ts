import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { verifyLoginTotp } from '../app/(login)/mfa/actions.ts';
import { beginPrimaryMfa, MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { beginTotpEnrollment, completeTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { csrfCookieName } from '../lib/security/csrf-tokens.ts';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

// AUTH-OPERATIONS-004: replay attempts must surface as a dedicated, secret-free security event, not
// merely an ordinary failed-verification response. Drives the real production verifyLoginTotp Server
// Action -- not a parallel helper -- through an actual TOTP counter replay (the same code, submitted
// against a second, independent login challenge) and proves both that the caller-facing response
// stays generic (no extra information disclosed) and that a distinct `mfa_replay_detected` row is
// durably enqueued for the account owner.

const applicationId = MFA_APPLICATION_ID;
const encryptionKey = randomBytes(32);
const continuationKey = randomBytes(32);
const recoveryKey = randomBytes(32);
const store = new PostgresMfaStore(sql);

Object.assign(process.env, {
  AUTH_SECRET: 'mfa-replay-test-auth-secret-long-enough',
  BASE_URL: 'http://localhost:3000',
  MFA_PENDING_AUTH_SIGNING_KEY: continuationKey.toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: recoveryKey.toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'replay-test',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'replay-test': encryptionKey.toString('base64url') }),
  RATE_LIMIT_HASH_KEY: 'mfa-replay-test-rate-limit-secret-long-enough',
});

class TestCookies implements MutableCookieStore {
  readonly values = new Map<string, string>();
  delete(name: string) { this.values.delete(name); }
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { name, value }; }
  set(name: string, value: string) { value ? this.values.set(name, value) : this.values.delete(name); }
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

function form(code: string, csrfToken: string) {
  const data = new FormData();
  data.set('code', code);
  data.set('csrf_token', csrfToken);
  return data;
}

async function dbUser(id: number) {
  const [user] = await sql<Record<string, unknown>[]>`select * from idoc.users where id=${id}`;
  assert.ok(user);
  return { ...user, accountState: user.account_state, deletedAt: user.deleted_at,
    emailVerifiedAt: user.email_verified_at, sessionVersion: Number(user.session_version) } as any;
}

async function privilegedTotpUser() {
  const user = await createUser();
  await grantRole(user.id, 'administrator');
  const enrolledAt = Date.now() - 30_000;
  const enrollment = await beginTotpEnrollment({
    accountLabel: user.email, applicationId, encryptionKey, issuer: 'IDOC', keyId: 'replay-test',
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

test('a replayed TOTP code against a second, independent login challenge enqueues mfa_replay_detected without leaking extra detail in the response', async () => {
  const fixture = await privilegedTotpUser();
  const cookies = new TestCookies();
  await issueTestCsrfToken(cookies, null);
  const csrfToken = () => cookies.get(csrfCookieName())?.value ?? '';

  const code = totp(fixture.secret);
  await withTestRequestCookies(cookies, async () => {
    assert.equal(await beginPrimaryMfa(fixture.user, 'password', '/dashboard'), true);
    await verifyLoginTotp({}, form(code, csrfToken()))
      .then(() => assert.fail('the first, legitimate submission should redirect'),
        (error) => assert.match(String(error), /NEXT_REDIRECT/));
  }, 'mfa-replay.example.test');

  // A second, independent login challenge for the same account, replaying the exact same code that
  // was already accepted on the first challenge -- the real signature of a stolen/replayed OTP.
  const replayResult = await withTestRequestCookies(cookies, async () => {
    assert.equal(await beginPrimaryMfa(fixture.user, 'password', '/dashboard'), true);
    return verifyLoginTotp({}, form(code, csrfToken()));
  }, 'mfa-replay.example.test');

  assert.deepEqual(replayResult, { error: 'Your verification session expired. Sign in again.' },
    'the response must stay the same generic message an attacker would see for any other non-accepted status');

  const rows = await sql<{ kind: string; recipient_email: string; dedupe_key: string }[]>`
    select kind,recipient_email,dedupe_key from idoc.auth_security_notification_outbox where user_id=${fixture.user.id}`;
  assert.equal(rows.length, 1, 'exactly one replay notification must be enqueued');
  assert.equal(rows[0].kind, 'mfa_replay_detected');
  assert.equal(rows[0].recipient_email, fixture.user.email);
  const serialized = JSON.stringify(rows[0]);
  assert.equal(serialized.includes(code), false, 'the raw replayed code must never reach the notification row');
});
