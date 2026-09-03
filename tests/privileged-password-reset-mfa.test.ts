import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync('app/(login)/recover-password/actions.ts', 'utf8');
const page = readFileSync('app/(login)/recover-password/page.tsx', 'utf8');
const otpStep = readFileSync('app/(login)/recover-password/otp-step.tsx', 'utf8');
const pending = readFileSync('lib/auth/pending-password-reset.ts', 'utf8');
const types = readFileSync('lib/auth/mfa/types.ts', 'utf8');

test('privileged password reset uses authoritative grants and canonical purpose-bound TOTP', () => {
  assert.match(actions, /authoritativeMfaRole\(user\.id\)/);
  assert.match(actions, /purpose: 'password-reset'/);
  assert.match(types, /'password-reset'/);
  assert.ok(actions.indexOf("role === 'admin'") < actions.indexOf("issueEmailOtp(email, 'password_reset'"));
  assert.doesNotMatch(actions, /users\.role/);
});

test('pending reset is a signed state machine without role or MFA material', () => {
  assert.match(pending, /stage: 'email-otp'/);
  assert.match(pending, /stage: 'totp'/);
  assert.match(pending, /stage: 'authorized'/);
  assert.doesNotMatch(pending, /encryptedSecret|recoveryCode|role:/);
});

test('anonymous recovery keeps one neutral verification surface for every unresolved state', () => {
  assert.match(page, /if \(pending\.stage === 'authorized'\) return <PasswordStep/);
  assert.match(page, /return <OtpStep \/>/);
  assert.doesNotMatch(page, /TotpStep|missing-factor|Additional recovery required|authenticator/);
  assert.match(otpStep, /Enter the 6-digit verification code for this recovery request/);
  assert.match(otpStep, /authenticator app/);
  assert.match(otpStep, /code sent to your email/);
  assert.doesNotMatch(otpStep, /We sent a 6-digit code to/);
});

// AUTH-SECRET-003, Codex review finding on the compromised-mfa-key pull request: a compromised TOTP
// key must never surface as a distinct error at this unauthenticated boundary -- doing so leaks that
// the account exists, is privileged, and specifically that its key is compromised, contrary to the
// neutral-surface property proven above.
test('a compromised TOTP key returns the same neutral error as every other unresolved recovery state', () => {
  const totpBranch = actions.slice(actions.indexOf('const role = await authoritativeMfaRole(pending.subjectId)'));
  const compromisedCatch = totpBranch.slice(0, totpBranch.indexOf("if (result.status !== 'accepted')"));
  assert.match(compromisedCatch, /CompromisedMfaKeyError/);
  assert.match(compromisedCatch, /auditCompromisedMfaKeyRejection/);
  assert.doesNotMatch(compromisedCatch.slice(compromisedCatch.indexOf('CompromisedMfaKeyError')),
    /error:\s*'[^']*(can no longer be used|contact support)/i);
  assert.match(compromisedCatch.slice(compromisedCatch.lastIndexOf('await auditCompromisedMfaKeyRejection')),
    /return neutralVerificationError;/);
});

test('completion revokes persisted sessions and requires fresh sign-in', () => {
  assert.match(actions, /tx\.update\(authSessions\)/);
  assert.match(actions, /sessionVersion: sql/);
  assert.match(actions, /redirect\('\/sign-in\?reset=success'\)/);
  assert.doesNotMatch(actions, /setSession/);
});

test('password-reset resend preserves the resolved subject for delivery-failure attribution', () => {
  const resendBranch = actions.slice(actions.indexOf('export const resendPasswordResetOtp'));
  assert.match(resendBranch,
    /issueEmailOtp\(pending\.email, 'password_reset', \{ origin, userId: pending\.subjectId \}\)/);
});
