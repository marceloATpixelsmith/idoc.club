import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync('app/(login)/recover-password/actions.ts', 'utf8');
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

test('completion revokes persisted sessions and requires fresh sign-in', () => {
  assert.match(actions, /tx\.update\(authSessions\)/);
  assert.match(actions, /sessionVersion: sql/);
  assert.match(actions, /redirect\('\/sign-in\?reset=success'\)/);
  assert.doesNotMatch(actions, /setSession/);
});
