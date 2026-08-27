import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const emailOtp = readFileSync('lib/auth/email-otp.ts', 'utf8');
const signupActions = readFileSync('app/(login)/sign-up/actions.ts', 'utf8');

test('email OTP rate-limit identifiers preserve issue buckets and fit varchar(30)', () => {
  const block = emailOtp.slice(
    emailOtp.indexOf('const RATE_LIMIT_PURPOSES'),
    emailOtp.indexOf('const digest')
  );

  for (const purpose of [
    'email_otp_login_verification',
    'email_otp_password_reset',
    'email_otp_signup_verification',
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

test('signup cookie state changes navigate to distinct same-route targets', () => {
  assert.match(signupActions, /startPendingSignup\(email\)[\s\S]*redirect\('\/sign-up\?stage=verify'\)/);
  assert.match(signupActions, /markPendingSignupVerified\(pending\.email\)[\s\S]*redirect\('\/sign-up\?stage=password'\)/);
});
