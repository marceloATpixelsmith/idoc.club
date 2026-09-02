import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { hash as hashBcrypt } from 'bcryptjs';
import { signIn } from '../app/(login)/actions.ts';
import { startPendingLogin } from '../lib/auth/pending-login.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { beginTotpEnrollment, completeTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import { MFA_APPLICATION_ID } from '../lib/auth/mfa/login.ts';
import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { comparePasswords, hashPassword, passwordHashNeedsUpgrade } from '../lib/auth/session.ts';
import { db } from '../lib/db/drizzle.ts';
import { users } from '../lib/db/schema.ts';
import { eq } from 'drizzle-orm';
import { issueTestCsrfToken } from './csrf-test-helper.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

// AUTH-STORAGE-005: "Credential storage MUST identify algorithm, parameters, and version and SHOULD
// rehash an older approved hash after successful authentication using the current profile." This
// drives the real production signIn Server Action -- not passwordHashNeedsUpgrade/hashPassword in
// isolation, which tests/password-hash.test.ts already covers -- against a real Postgres row seeded
// with a real bcrypt hash (IDOC's pre-Argon2id-retrofit format), proving the actual login path
// detects and upgrades it, and that the upgraded hash itself still authenticates the same password.

const password = 'Correct Horse Battery Staple 42!';
const encryptionKey = randomBytes(32);
const store = new PostgresMfaStore(sql);

Object.assign(process.env, {
  AUTH_SECRET: 'password-hash-migration-secret-long-enough',
  BASE_URL: 'http://localhost:3000',
  MFA_PENDING_AUTH_SIGNING_KEY: randomBytes(32).toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: randomBytes(32).toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'password-hash-migration',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'password-hash-migration': encryptionKey.toString('base64url') }),
  RATE_LIMIT_HASH_KEY: 'password-hash-migration-rate-limit-secret',
  REMEMBER_TOTP_DEVICE_ENABLED: 'false',
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

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

async function redirected(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => String(error).includes('NEXT_REDIRECT'));
}

test('a real bcrypt-hashed credential is rehashed to the current Argon2id profile after a genuinely successful signIn, and the new hash itself still authenticates', async () => {
  const fixture = await createUser('active');
  await grantRole(fixture.id, 'administrator');
  const bcryptHash = await hashBcrypt(password, 10);
  await sql`update idoc.users set password_hash=${bcryptHash} where id=${fixture.id}`;

  const enrollment = await beginTotpEnrollment({ accountLabel: fixture.email, applicationId: MFA_APPLICATION_ID,
    encryptionKey, issuer: 'IDOC', keyId: 'password-hash-migration', nowMs: Date.now() - 30_000, store, subjectId: String(fixture.id) });
  const secret = new URL(enrollment.provisioningUri).searchParams.get('secret')!;
  assert.equal((await completeTotpEnrollment({ applicationId: MFA_APPLICATION_ID, code: totp(secret, Date.now() - 30_000),
    factorId: enrollment.factorId, nowMs: Date.now() - 30_000, resolveKey: () => encryptionKey, store,
    subjectId: String(fixture.id), transactionId: enrollment.transactionId })).status, 'activated');

  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(fixture.email);
    // A real, genuinely correct password against the real production credential-comparison path
    // (comparePasswords' bcrypt fallback branch) -- this must succeed and proceed to the account's
    // real next step (MFA challenge for a privileged account), not stop at the password gate.
    await redirected(() => signIn({}, form({ csrf_token, email: fixture.email, password })));
  });

  const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, fixture.id)).limit(1);
  assert.notEqual(row.passwordHash, bcryptHash, 'the stored hash must have changed');
  assert.equal(passwordHashNeedsUpgrade(row.passwordHash), false, 'the new hash must be the current Argon2id profile');
  assert.match(row.passwordHash, /^argon2id\$v=19\$/);
  assert.equal(await comparePasswords(password, row.passwordHash), true, 'the upgraded hash must still authenticate the same password');
  assert.equal(await comparePasswords(`${password}x`, row.passwordHash), false, 'the upgraded hash must reject a wrong password');
});

test('a credential already on the current Argon2id profile is left untouched by signIn', async () => {
  const fixture = await createUser('active');
  await grantRole(fixture.id, 'administrator');
  const argon2Password = 'Already Modern Passphrase 99!';
  // hashPassword() itself is exercised elsewhere (tests/password-hash.test.ts); using it here just
  // seeds a real current-profile row -- the point under test is signIn's conditional, not hashing.
  const currentHash = await hashPassword(argon2Password);
  await sql`update idoc.users set password_hash=${currentHash} where id=${fixture.id}`;

  const enrollment = await beginTotpEnrollment({ accountLabel: fixture.email, applicationId: MFA_APPLICATION_ID,
    encryptionKey, issuer: 'IDOC', keyId: 'password-hash-migration', nowMs: Date.now() - 30_000, store, subjectId: String(fixture.id) });
  const secret = new URL(enrollment.provisioningUri).searchParams.get('secret')!;
  assert.equal((await completeTotpEnrollment({ applicationId: MFA_APPLICATION_ID, code: totp(secret, Date.now() - 30_000),
    factorId: enrollment.factorId, nowMs: Date.now() - 30_000, resolveKey: () => encryptionKey, store,
    subjectId: String(fixture.id), transactionId: enrollment.transactionId })).status, 'activated');

  const cookies = new TestCookies();
  const csrf_token = await issueTestCsrfToken(cookies, null);
  await withTestRequestCookies(cookies, async () => {
    await startPendingLogin(fixture.email);
    await redirected(() => signIn({}, form({ csrf_token, email: fixture.email, password: argon2Password })));
  });

  const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, fixture.id)).limit(1);
  assert.equal(row.passwordHash, currentHash, 'an already-current hash must not be rewritten on every login');
});
