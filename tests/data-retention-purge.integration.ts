import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { purgeExpiredAuthRecords } from '../lib/security/data-retention-purge.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

const DAY_MS = 24 * 60 * 60 * 1000;

test('purgeExpiredAuthRecords deletes rows whose expiry is more than 30 days past, and leaves everything else untouched', async () => {
  const user = await createUser();
  const now = new Date('2026-06-15T00:00:00Z');
  const wellPastGrace = new Date(now.getTime() - 31 * DAY_MS);
  const withinGrace = new Date(now.getTime() - 29 * DAY_MS);
  const notYetExpired = new Date(now.getTime() + DAY_MS);

  await sql`insert into idoc.email_otp_codes(user_id,email,purpose,code_hash,expires_at)
    values (${user.id},${user.email},'login_verification','old-hash',${wellPastGrace.toISOString()}),
           (${user.id},${user.email},'login_verification','recent-hash',${withinGrace.toISOString()}),
           (${user.id},${user.email},'login_verification','live-hash',${notYetExpired.toISOString()})`;

  await sql`insert into idoc.account_tokens(user_id,purpose,token_hash,expires_at)
    values (${user.id},'password_reset','old-token-hash',${wellPastGrace.toISOString()}),
           (${user.id},'password_reset','live-token-hash',${notYetExpired.toISOString()})`;

  await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
    values (${'old-session'},${user.id},1,${wellPastGrace.toISOString()},${wellPastGrace.toISOString()},${wellPastGrace.toISOString()}),
           (${'live-session'},${user.id},1,${now.toISOString()},${now.toISOString()},${notYetExpired.toISOString()})`;

  await sql`insert into idoc.login_trusted_devices(trusted_device_id,user_id,application_id,token_digest,session_version_at_issue,issued_at,expires_at)
    values (${randomUUID()},${user.id},'idoc-web','old-device-digest',1,${wellPastGrace.toISOString()},${wellPastGrace.toISOString()}),
           (${randomUUID()},${user.id},'idoc-web','live-device-digest',1,${now.toISOString()},${notYetExpired.toISOString()})`;

  const [factor] = await sql<{ factor_id: string }[]>`insert into idoc.mfa_factors(factor_id,user_id,application_id,factor_type,status,encrypted_secret,encryption_key_id)
    values (${randomUUID()},${user.id},'idoc-web','totp','pending','fixture-encrypted-secret','fixture-key-v1') returning factor_id`;

  await sql`insert into idoc.mfa_enrollment_transactions(transaction_id,user_id,application_id,factor_id,purpose,expires_at)
    values (${randomUUID()},${user.id},'idoc-web',${factor.factor_id},'mfa-enrollment',${wellPastGrace.toISOString()}),
           (${randomUUID()},${user.id},'idoc-web',${factor.factor_id},'mfa-enrollment',${notYetExpired.toISOString()})`;

  await sql`insert into idoc.mfa_challenge_transactions(transaction_id,user_id,application_id,purpose,expires_at,max_attempts)
    values (${randomUUID()},${user.id},'idoc-web','login',${wellPastGrace.toISOString()},5),
           (${randomUUID()},${user.id},'idoc-web','login',${notYetExpired.toISOString()},5)`;

  const result = await purgeExpiredAuthRecords(now);
  assert.deepEqual(result, {
    accountTokens: 1, authSessions: 1, emailOtpCodes: 1,
    loginTrustedDevices: 1, mfaChallengeTransactions: 1, mfaEnrollmentTransactions: 1,
  });

  assert.equal((await sql`select count(*)::int as count from idoc.email_otp_codes`)[0].count, 2);
  assert.equal((await sql`select count(*)::int as count from idoc.account_tokens`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.auth_sessions`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.login_trusted_devices`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.mfa_enrollment_transactions`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.mfa_challenge_transactions`)[0].count, 1);

  const remainingOtp = await sql`select code_hash from idoc.email_otp_codes order by expires_at`;
  assert.deepEqual(remainingOtp.map((row) => row.code_hash), ['recent-hash', 'live-hash']);
});

test('purgeExpiredAuthRecords is a no-op against an empty database', async () => {
  const result = await purgeExpiredAuthRecords(new Date());
  assert.deepEqual(result, {
    accountTokens: 0, authSessions: 0, emailOtpCodes: 0,
    loginTrustedDevices: 0, mfaChallengeTransactions: 0, mfaEnrollmentTransactions: 0,
  });
});
