import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const emailOtp = readFileSync('lib/auth/email-otp.ts', 'utf8');
const signupActions = readFileSync('app/(login)/sign-up/actions.ts', 'utf8');
const rateLimit = readFileSync('lib/security/rate-limit.ts', 'utf8');

test('email OTP rate-limit identifiers preserve issue buckets and fit varchar(30)', () => {
  const block = emailOtp.slice(
    emailOtp.indexOf('const RATE_LIMIT_PURPOSES'),
    emailOtp.indexOf('const digest')
  );

  for (const purpose of [
    'email_otp_google_disconnect',
    'email_otp_login_verification',
    'email_otp_password_reset',
    'email_otp_signup_verification',
    'otp_verify_google_disconnect',
    'otp_verify_login',
    'otp_verify_reset',
    'otp_verify_signup',
  ]) {
    assert.match(block, new RegExp(`'${purpose}'`));
    assert.ok(purpose.length <= 30, `${purpose} exceeds varchar(30)`);
  }

  assert.doesNotMatch(emailOtp, /email_otp_verify_\$\{purpose\}/);
  assert.match(emailOtp, /checkRateLimit\(RATE_LIMIT_PURPOSES\[purpose\]\.issue/);
  assert.match(emailOtp, /checkRateLimit\(RATE_LIMIT_PURPOSES\[purpose\]\.verify/);
});

test('every OTP verify purpose gets the same 5-attempt allowance as the code lockout itself, not the smaller default', () => {
  assert.match(emailOtp, /MAX_VERIFY_ATTEMPTS = 5/);
  const block = rateLimit.slice(
    rateLimit.indexOf('const IDENTIFIER_MAX_REQUESTS'),
    rateLimit.indexOf('function identifierMaxRequestsFor'),
  );
  for (const purpose of ['otp_verify_google_disconnect', 'otp_verify_login', 'otp_verify_reset', 'otp_verify_signup']) {
    assert.match(block, new RegExp(`${purpose}: 5,`), `${purpose} must be capped at 5 attempts, matching MAX_VERIFY_ATTEMPTS -- otherwise the default (lower) allowance locks a member out before they exhaust the code's own real lockout`);
  }
});

test('signup cookie state changes navigate to distinct same-route targets', () => {
  assert.match(signupActions, /startPendingSignup\(email, emailDisplay, membership\)[\s\S]*redirect\('\/sign-up\?stage=verify'\)/);
  assert.match(signupActions, /markPendingSignupVerified\(pending\)[\s\S]*redirect\('\/sign-up\?stage=password'\)/);
});
