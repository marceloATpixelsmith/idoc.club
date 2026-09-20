import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync('app/(dashboard)/dashboard/security/actions.ts', 'utf8');
const page = readFileSync('app/(dashboard)/dashboard/security/page.tsx', 'utf8');
const client = readFileSync('app/(dashboard)/dashboard/security/security-client.tsx', 'utf8');
const googleCard = readFileSync('app/(dashboard)/dashboard/security/google-identity-card.tsx', 'utf8');
const queries = readFileSync('lib/db/queries.ts', 'utf8');
const devices = readFileSync('lib/auth/login-device-trust.ts', 'utf8');
const registry = readFileSync('lib/auth/session-registry.ts', 'utf8');
const loginActions = readFileSync('app/(login)/actions.ts', 'utf8');
const signInPage = readFileSync('app/(login)/sign-in/page.tsx', 'utf8');

const FORBIDDEN_RENDERED_SECRETS = /passwordHash|encryptedSecret|tokenDigest|recoveryCodeId|session cookie|sessionVersion/;

test('current-session management is bound to the authenticated canonical session and ownership', () => {
  assert.match(actions, /const current = await canonicalSession\(user\.id\)/);
  assert.match(actions, /session\.user\.id !== userId/);
  assert.match(actions, /if \(sessionId === current\.sessionId\)/);
  assert.match(actions, /revokeSession\(sessionId, user\.id/);
  assert.match(actions, /revokeOtherUserSessionsWithEvidence\(\{[\s\S]*currentSessionId: current\.sessionId[\s\S]*userId: user\.id/);
  assert.match(registry, /where\s+user_id\s*=\s*\$\{input\.userId\}\s+and\s+session_id\s*<>\s*\$\{input\.currentSessionId\}/);
  assert.match(registry, /client\.begin\(/);
  assert.match(registry, /auth_security_notification_outbox/);
});

test('security page lists only registry sessions matching the current server-owned session version', () => {
  assert.match(page, /listActiveSessions\(user\.id, user\.sessionVersion\)/);
  assert.match(registry, /export async function listActiveSessions\(userId: number, currentSessionVersion: number\)/);
  assert.match(registry, /session_version = \$\{currentSessionVersion\}/);
});

test('security page returns only safe session presentation fields and server-owned current binding', () => {
  assert.match(page, /currentSessionId=\{session\.sessionId\}/);
  assert.match(page, /absoluteExpiresAt, authenticatedAt, deviceLabel, lastActivityAt, sessionId/);
  assert.doesNotMatch(client, FORBIDDEN_RENDERED_SECRETS);
  assert.doesNotMatch(client, /bearer|JWT|token digest|factorId|challenge transaction/i);
});

test('ordinary-device management reads the host-only cookie and never accepts token identifiers', () => {
  assert.match(devices, /cookies\(\)\)\.get\(LOGIN_DEVICE_TRUST_COOKIE\)/);
  assert.match(devices, /eq\(loginTrustedDevices\.tokenDigest, digest\(token\)\)/);
  assert.match(devices, /eq\(loginTrustedDevices\.userId, userId\)/);
  assert.match(devices, /eq\(loginTrustedDevices\.applicationId, MFA_APPLICATION_ID\)/);
  assert.match(actions, /authoritativeMfaRole\(user\.id\) !== 'member'/);
  assert.doesNotMatch(actions, /tokenDigest|trustedDeviceId/);
});

test('authenticator replacement enters the canonical recovery-authorized flow without factor mutation', () => {
  assert.match(actions, /setPendingPrimaryAuth\([\s\S]*stage: 'recovery-entry'/);
  assert.match(actions, /redirect\('\/mfa'\)/);
  assert.doesNotMatch(actions, /finalizeAuthenticatorReplacement|replaceRecoveryCodes|encryptedSecret/);
});

test('password change and deletion deliberately invalidate authentication state', () => {
  const passwordChange = loginActions.slice(loginActions.indexOf('export const updatePassword'), loginActions.indexOf('const deleteAccountSchema'));
  assert.match(passwordChange, /comparePasswords\(currentPassword, user\.passwordHash\)/);
  assert.match(passwordChange, /sessionVersion: sql`\$\{users\.sessionVersion\} \+ 1`/);
  assert.match(passwordChange, /await clearSession\(\);\s*redirect\('\/sign-in\?password=changed'\)/);
  const deletion = loginActions.slice(loginActions.indexOf('export const deleteAccount'), loginActions.indexOf('const updateAccountSchema'));
  assert.ok(deletion.indexOf('await deleteOwnAccount()') < deletion.indexOf("await revokeAllUserSessions(user.id, 'account-deleted')"));
  assert.match(deletion, /forgetAllLoginDevices\(user\.id, 'account-deleted'\)/);
  assert.match(deletion, /requireFreshStepUp\(user, 'change-security-settings'/);
});

test('a Google-only account (no known password) does not see the password-change card, since it has no current password to enter', () => {
  assert.match(queries, /hasPassword: user\.passwordSetAt !== null/);
  assert.match(page, /hasPassword=\{user\.hasPassword\}/);
  assert.match(client, /\{hasPassword \? <Card>/);
  assert.match(client, /<CardHeader><CardTitle>Password<\/CardTitle><\/CardHeader>/);
});

test('a Google-only account is offered a create-a-password control on the Google card instead of a current-password field it cannot fill in, gated behind an emailed verification code', () => {
  assert.match(googleCard, /GoogleIdentityCard\(\{ hasPassword \}: \{ hasPassword: boolean \}\)/);
  assert.match(googleCard, /const needsPasswordToDisconnect = linked && !hasPassword;/);
  assert.match(googleCard, /needsPasswordToDisconnect \? \(/);
  assert.match(googleCard, /action=\{sendCodeAction\}/);
  assert.match(googleCard, /sendGoogleDisconnectVerificationCode/);
  assert.match(googleCard, /name="otpCode"/);
  assert.match(googleCard, /<PasswordField autoComplete="new-password"[^/]*name="newPassword" required \/>/);
  assert.match(googleCard, /action=\{createAction\}/);
  assert.match(googleCard, /createPasswordAndDisconnectGoogle/);
  // The current-password field/Disconnect button remain for an account that already has a real
  // password (one that signed up normally and later linked Google) -- only the passwordless case
  // gets the new control.
  assert.match(googleCard, /id="google-current-password"/);
});

test('an ordinary member (no TOTP factor) gets a real, independent proof of identity before the sole credential is replaced, since requireFreshStepUp alone is a no-op for them', () => {
  assert.match(actions, /export const sendGoogleDisconnectVerificationCode = validatedActionWithUser\(emptySchema, async \(_, __, user\) => \{/);
  const send = actions.slice(actions.indexOf('export const sendGoogleDisconnectVerificationCode'), actions.indexOf('const createPasswordSchema'));
  assert.match(send, /if \(user\.passwordSetAt\) return \{ error:/);
  assert.match(send, /issueEmailOtp\(user\.email, 'google_disconnect_verification', \{ origin, userId: user\.id \}\)/);
});

test('creating a password to disconnect Google requires fresh step-up, a verified one-time email code, rejects a breached password, and saves the password before ever touching the Google link', () => {
  const create = actions.slice(actions.indexOf('export const createPasswordAndDisconnectGoogle'));
  assert.match(create, /requireFreshStepUp\(user, 'change-security-settings'/);
  assert.match(create, /if \(user\.passwordSetAt\) return \{ error:/);
  assert.match(create, /checkPasswordBreached\(newPassword\)/);
  assert.match(create, /notifyWebmasterOfBreachedPasswordAttempt\(\{ email: user\.email, source: 'google-disconnect' \}\)/);
  assert.match(actions, /otpCode: z\.string\(\)\.regex\(\/\^\\d\{6\}\$\/, /);
  assert.match(create, /verifyEmailOtp\(user\.email, 'google_disconnect_verification', otpCode, otpOrigin, user\.id\)/);
  assert.match(create, /if \(otpResult !== 'verified'\)/);
  const otpVerifyIndex = create.indexOf('verifyEmailOtp(');
  const passwordSaveIndex = create.indexOf('tx.update(users).set');
  const unlinkIndex = create.indexOf('unlinkGoogleIdentity(');
  assert.ok(otpVerifyIndex > 0 && otpVerifyIndex < passwordSaveIndex && passwordSaveIndex < unlinkIndex,
    'the email code must be verified before the password is saved, and the password must be saved before Google is unlinked, never after');
  assert.match(create, /passwordSetAt: now/);
  assert.match(create, /sessionVersion: sql`\$\{users\.sessionVersion\} \+ 1`/);
  assert.match(create, /account\.password\.created/);
  // Every path out of this action, once the password has been saved, ends in clearSession() and a
  // redirect -- never an inline error -- because the sessionVersion bump already invalidates the
  // current session regardless of whether the Google unlink that follows succeeds. An inline error
  // here would let the member retry from a session this request has already invalidated.
  assert.match(create, /await consumeFreshStepUp\(\);\s*await clearSession\(\);/);
  assert.match(create, /redirect\('\/sign-in\?password=created'\)/);
  assert.match(create, /redirect\('\/sign-in\?password=created&google=unlink-failed'\)/);
  // The sign-in page must actually explain this redirect, not silently show nothing -- a member
  // sent here after a successful password save but a failed unlink should not be left thinking the
  // whole thing failed.
  assert.match(signInPage, /value === 'unlink-failed'/);
  assert.doesNotMatch(create.slice(unlinkIndex), /return \{ error:/, 'no inline error may be returned after the password is already saved -- the session is already invalidated by then');
});

test('every session-mutating form on the My Security page disables its submit button while its own action is pending, preventing a double-click from firing a duplicate request', () => {
  const pendingFlags: Record<string, string> = {
    beginAuthenticatorReplacement: 'isReplacePending', forgetAllRememberedDevices: 'isForgetAllPending',
    forgetThisDevice: 'isForgetCurrentPending', logOutOtherSessions: 'isLogoutOthersPending', logOutSession: 'isLogoutOnePending',
  };
  for (const [action, flag] of Object.entries(pendingFlags)) {
    assert.match(client, new RegExp(`\\[\\w+, \\w+, ${flag}(?:, \\w+)?\\] = (?:useActionState(?:<\\w+State, FormData>)?|useFreshStepUpAction)\\(${action}, \\{\\}(?: as \\w+State)?\\)`), `${action} must destructure its pending flag (${flag})`);
    assert.match(client, new RegExp(`disabled=\\{[^}]*${flag}[^}]*\\}`), `${flag} must gate a submit button's disabled prop`);
  }
});
