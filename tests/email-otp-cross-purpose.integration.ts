import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyEmailOtp } from '../lib/auth/email-otp.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// verifyEmailOtp calls checkRateLimit internally, which requires RATE_LIMIT_HASH_KEY.
// Self-set it (matching tests/account-token-lifecycles.integration.ts's convention) so
// this file does not depend on a specific CI workflow's env block.
process.env.RATE_LIMIT_HASH_KEY ??= 'integration-only-rate-limit-secret';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const EMAIL = 'otp-cross-purpose@example.test';
const CODE = '482913';

async function insertCode(overrides: {
  purpose?: 'login_verification' | 'password_reset' | 'signup_verification';
  code?: string;
  expiresAt?: Date;
  attemptCount?: number;
  consumedAt?: Date | null;
  userId?: number | null;
} = {}) {
  const purpose = overrides.purpose ?? 'signup_verification';
  const code = overrides.code ?? CODE;
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000);
  const attemptCount = overrides.attemptCount ?? 0;
  await sql`insert into idoc.email_otp_codes (user_id, email, purpose, code_hash, expires_at, attempt_count, consumed_at)
    values (${overrides.userId ?? null}, ${EMAIL}, ${purpose}, ${digest(code)}, ${expiresAt.toISOString()}, ${attemptCount}, ${overrides.consumedAt ?? null})`;
}

test.beforeEach(resetIdoc);
test.after(closeHarness);

test('the correct code verifies under the purpose it was actually issued for', async () => {
  await insertCode({ purpose: 'signup_verification' });
  assert.equal(await verifyEmailOtp(EMAIL, 'signup_verification', CODE), 'verified');
});

test('the exact same valid code is rejected when presented under a different purpose than it was issued for', async () => {
  await insertCode({ purpose: 'signup_verification' });
  assert.equal(await verifyEmailOtp(EMAIL, 'login_verification', CODE), 'invalid');
  assert.equal(await verifyEmailOtp(EMAIL, 'password_reset', CODE), 'invalid');
  // The code is still genuinely unconsumed and valid under its real purpose after the cross-purpose attempts.
  assert.equal(await verifyEmailOtp(EMAIL, 'signup_verification', CODE), 'verified');
});

test('a cross-purpose verification attempt does not consume or lock the code for its real purpose', async () => {
  await insertCode({ purpose: 'password_reset' });
  // Verification itself is rate-limited to 3 requests per email per 15-minute window (independent
  // per purpose bucket), so this deliberately stays under that limit rather than looping 5 times.
  assert.equal(await verifyEmailOtp(EMAIL, 'login_verification', CODE), 'invalid');
  assert.equal(await verifyEmailOtp(EMAIL, 'login_verification', CODE), 'invalid');
  const [row] = await sql<{ attempt_count: number; consumed_at: Date | null }[]>`
    select attempt_count, consumed_at from idoc.email_otp_codes where email = ${EMAIL} and purpose = 'password_reset'`;
  assert.equal(row.attempt_count, 0, 'attempts against the wrong purpose must not increment the real code\'s counter');
  assert.equal(row.consumed_at, null);
  assert.equal(await verifyEmailOtp(EMAIL, 'password_reset', CODE), 'verified');
});

test('an expired code is rejected even with the correct purpose and code value', async () => {
  await insertCode({ purpose: 'signup_verification', expiresAt: new Date(Date.now() - 1000) });
  assert.equal(await verifyEmailOtp(EMAIL, 'signup_verification', CODE), 'expired');
});

test('a code already at the maximum attempt count is locked immediately, even for the correct code, without a fresh attempt being charged', async () => {
  // Seeded directly at the boundary rather than looped, since verification itself is separately
  // rate-limited to 3 requests per email per 15-minute window (see the rate-limit tests below) —
  // reaching 5 attempt_count via 5 real verifyEmailOtp calls is not possible inside one window.
  await insertCode({ purpose: 'login_verification', attemptCount: 5 });
  assert.equal(await verifyEmailOtp(EMAIL, 'login_verification', CODE), 'locked');
  const [row] = await sql<{ attempt_count: number }[]>`select attempt_count from idoc.email_otp_codes where email = ${EMAIL}`;
  assert.equal(row.attempt_count, 5, 'a pre-locked code does not get its attempt counter incremented further');
});

test('the attempt immediately before the boundary still charges normally, and the one after it is locked', async () => {
  await insertCode({ purpose: 'login_verification', attemptCount: 4 });
  assert.equal(await verifyEmailOtp(EMAIL, 'login_verification', '000000'), 'invalid');
  const [row] = await sql<{ attempt_count: number }[]>`select attempt_count from idoc.email_otp_codes where email = ${EMAIL}`;
  assert.equal(row.attempt_count, 5);
  assert.equal(await verifyEmailOtp(EMAIL, 'login_verification', CODE), 'locked');
});

test('a code cannot be replayed after it has already been consumed', async () => {
  await insertCode({ purpose: 'signup_verification' });
  assert.equal(await verifyEmailOtp(EMAIL, 'signup_verification', CODE), 'verified');
  assert.equal(await verifyEmailOtp(EMAIL, 'signup_verification', CODE), 'invalid');
});

test('a userId-scoped verification (login/reset OTP tied to an existing account) rejects a code issued for a different user', async () => {
  const owner = await createUser();
  const attacker = await createUser();
  await insertCode({ purpose: 'login_verification', userId: owner.id });
  assert.equal(await verifyEmailOtp(EMAIL, 'login_verification', CODE, 'test-origin', attacker.id), 'invalid');
  assert.equal(await verifyEmailOtp(EMAIL, 'login_verification', CODE, 'test-origin', owner.id), 'verified');
});

test('a non-6-digit submission is rejected without ever querying the database for a match', async () => {
  await insertCode({ purpose: 'signup_verification' });
  assert.equal(await verifyEmailOtp(EMAIL, 'signup_verification', '12345'), 'invalid');
  assert.equal(await verifyEmailOtp(EMAIL, 'signup_verification', '1234567'), 'invalid');
  assert.equal(await verifyEmailOtp(EMAIL, 'signup_verification', 'abcdef'), 'invalid');
  // The real code is still untouched (attempt count 0) since format-invalid input short-circuits first.
  const [row] = await sql<{ attempt_count: number }[]>`select attempt_count from idoc.email_otp_codes where email = ${EMAIL}`;
  assert.equal(row.attempt_count, 0);
});
