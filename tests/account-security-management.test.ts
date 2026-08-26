import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync('app/(dashboard)/dashboard/security/actions.ts', 'utf8');
const page = readFileSync('app/(dashboard)/dashboard/security/page.tsx', 'utf8');
const client = readFileSync('app/(dashboard)/dashboard/security/security-client.tsx', 'utf8');
const devices = readFileSync('lib/auth/login-device-trust.ts', 'utf8');
const registry = readFileSync('lib/auth/session-registry.ts', 'utf8');
const loginActions = readFileSync('app/(login)/actions.ts', 'utf8');

const FORBIDDEN_RENDERED_SECRETS = /passwordHash|encryptedSecret|tokenDigest|recoveryCodeId|session cookie|sessionVersion/;

test('current-session management is bound to the authenticated canonical session and ownership', () => {
  assert.match(actions, /const current = await canonicalSession\(user\.id\)/);
  assert.match(actions, /session\.user\.id !== userId/);
  assert.match(actions, /if \(sessionId === current\.sessionId\)/);
  assert.match(actions, /revokeSession\(sessionId, user\.id/);
  assert.match(actions, /revokeOtherUserSessionsWithEvidence\(\{[\s\S]*currentSessionId: current\.sessionId[\s\S]*userId: user\.id/);
  assert.match(registry, /where user_id = \$\{input\.userId\} and session_id <> \$\{input\.currentSessionId\}/);
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
  assert.match(page, /absoluteExpiresAt, authenticatedAt, lastActivityAt, sessionId/);
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
