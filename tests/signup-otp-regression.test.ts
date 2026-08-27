import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const emailOtp = readFileSync('lib/auth/email-otp.ts', 'utf8');
const signupActions = readFileSync('app/(login)/sign-up/actions.ts', 'utf8');

test('email OTP rate-limit purpose identifiers fit the persisted varchar(30) bucket', () => {
  const block = emailOtp.slice(
    emailOtp.indexOf('const RATE_LIMIT_PURPOSES'),
    emailOtp.indexOf('const digest')
  );
  const purposes = [...block.matchAll(/'(otp_(?:issue|verify)_[a-z]+)'/g)].map((match) => match[1]);

  assert.equal(purposes.length, 6);
  for (const purpose of purposes) assert.ok(purpose.length <= 30, `${purpose} exceeds varchar(30)`);
  assert.doesNotMatch(emailOtp, /email_otp_verify_\$\{purpose\}/);
  assert.match(emailOtp, /checkRateLimit\(RATE_LIMIT_PURPOSES\[purpose\]\.issue/);
  assert.match(emailOtp, /checkRateLimit\(RATE_LIMIT_PURPOSES\[purpose\]\.verify/);
});

test('signup cookie state changes navigate to distinct same-route targets', () => {
  assert.match(signupActions, /startPendingSignup\(email\)[\s\S]*redirect\('\/sign-up\?stage=verify'\)/);
  assert.match(signupActions, /markPendingSignupVerified\(pending\.email\)[\s\S]*redirect\('\/sign-up\?stage=password'\)/);
});
