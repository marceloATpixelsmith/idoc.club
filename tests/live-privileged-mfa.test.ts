import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { decideMfa } from '../lib/auth/mfa/decision.ts';
import { mfaConfiguration } from '../lib/runtime/configuration.ts';

const root = process.cwd();
const source = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('IDOC privileged policy requires TOTP and members do not', () => {
  const input = { hasActiveTotp: true, rememberedDeviceValid: true, rememberTotpDevice: false,
    requirement: 'privileged-users' as const };
  assert.equal(decideMfa({ ...input, role: 'member' }), 'not-required');
  assert.equal(decideMfa({ ...input, role: 'admin' }), 'challenge-required');
  assert.equal(decideMfa({ ...input, role: 'super-admin' }), 'challenge-required');
});

test('trusted IDOC role mapping reads active grants and ignores client/profile role values', () => {
  const login = source('lib/auth/mfa/login.ts');
  assert.match(login, /applicationRoles\.userId/);
  assert.match(login, /isNull\(applicationRoles\.revokedAt\)/);
  assert.doesNotMatch(login, /formData|searchParams|users\.role|profile/);
});

test('password and Google issue sessions only after the shared MFA decision', () => {
  for (const file of ['app/(login)/sign-in/actions.ts', 'app/api/auth/google/callback/route.ts']) {
    const body = source(file);
    assert.ok(body.indexOf('await beginPrimaryMfa(') < body.indexOf('await setSession('), file);
  }
  const password = source('app/(login)/actions.ts');
  const privileged = password.slice(password.lastIndexOf("if (await beginPrimaryMfa(foundUser"));
  assert.ok(privileged.indexOf('await beginPrimaryMfa(') < privileged.indexOf('await setSession('));
  const googleAccount = source('lib/auth/google-account.ts');
  assert.doesNotMatch(googleAccount, /setSession\(/);
});

test('pending MFA is separate from canonical sessions and MFA completion orders persistence before session issuance', () => {
  const pending = source('lib/auth/mfa/pending-primary-auth.ts');
  assert.match(pending, /idoc_pending_primary_mfa/);
  assert.doesNotMatch(pending, /registerSession|sessionCookieName/);
  const actions = source('app/(login)/mfa/actions.ts');
  assert.ok(actions.indexOf("result.status !== 'accepted'") < actions.indexOf('await setSession(context.user)'));
  assert.ok(actions.indexOf("result.status !== 'activated'") < actions.lastIndexOf('await setSession(context.user)'));
});

test('recovery authorizes only purpose-bound replacement and acknowledgement precedes session creation', () => {
  const actions = source('app/(login)/mfa/actions.ts');
  const recoverySecurity = source('lib/auth/mfa/recovery-security.ts');
  const finalization = source('lib/auth/mfa/replacement-finalization.ts');
  assert.match(actions, /consumeRecoveryCodeWithEvidence\(/);
  assert.match(recoverySecurity, /client\.begin\(/);
  assert.match(recoverySecurity, /update idoc\.mfa_recovery_codes set consumed_at=/);
  assert.match(recoverySecurity, /auth\.mfa\.recovery_code\.used/);
  assert.match(recoverySecurity, /auth_security_notification_outbox/);
  assert.match(actions, /purpose: 'authenticator-replacement'/);
  assert.match(actions, /mfa_recovery_code_verify/);
  assert.match(actions, /mfa_enrollment_confirm/);
  assert.doesNotMatch(actions.slice(actions.indexOf('export const authorizeAuthenticatorRecovery'),
    actions.indexOf('export const confirmTotpEnrollment')), /setSession|registerSession/);
  const acknowledge = actions.indexOf('export const acknowledgeRecoveryCodes');
  assert.ok(actions.indexOf('await setSession(context.user)', acknowledge) > acknowledge);
  assert.match(actions, /finalizeAuthenticatorReplacement\(/);
  assert.ok(actions.indexOf("stage: 'recovery-ack'") < actions.indexOf('await finalizeAuthenticatorReplacement('));
  assert.match(finalization, /client\.begin\(/);
  assert.match(finalization, /status='replaced'/);
  assert.match(finalization, /delete from idoc\.mfa_recovery_codes/);
  assert.match(finalization, /session_version=session_version\+1/);
  assert.match(finalization, /update idoc\.auth_sessions/);
});

test('recovery continuation is authenticated, short-lived, and contains no factor plaintext', () => {
  const pending = source('lib/auth/mfa/pending-primary-auth.ts');
  assert.match(pending, /SignJWT/);
  assert.match(pending, /TTL_SECONDS = 10 \* 60/);
  assert.match(pending, /httpOnly: true/);
  assert.match(pending, /sameSite: 'lax'/);
  assert.doesNotMatch(pending, /recoveryCode|totpSecret|encryptedSecret/);
});

test('MFA crypto configuration fails closed without or with malformed keys', () => {
  assert.throws(() => mfaConfiguration({}), /MFA_TOTP_ACTIVE_KEY_ID/);
  assert.throws(() => mfaConfiguration({ MFA_PENDING_AUTH_SIGNING_KEY: 'bad', MFA_RECOVERY_CODE_DIGEST_KEY: 'bad',
    MFA_TOTP_ACTIVE_KEY_ID: 'v1', MFA_TOTP_ENCRYPTION_KEYS: '{"v1":"bad"}' }), /MFA_TOTP_ENCRYPTION_KEYS/);
});
