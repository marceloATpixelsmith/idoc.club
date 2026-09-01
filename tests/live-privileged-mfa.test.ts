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

test('AUTH-SECRET-003: every production TOTP decrypt call site routes through the shared compromised-key check and audits a rejection', () => {
  const actions = source('app/(login)/mfa/actions.ts');
  const recoverPassword = source('app/(login)/recover-password/actions.ts');
  const totp = source('lib/auth/mfa/totp.ts');
  const audit = source('lib/auth/mfa/compromised-key-audit.ts');

  // Not one production call site is allowed to still build its own inline resolveKey closure --
  // that was exactly how three of these four call sites had zero compromised-key check before this
  // pull request.
  assert.doesNotMatch(actions, /const key = config\.encryptionKeys\.get\(keyId\); if \(!key\)/);
  assert.doesNotMatch(recoverPassword, /const key = config\.encryptionKeys\.get\(keyId\); if \(!key\)/);
  const resolveKeyCallSites = [...actions.matchAll(/resolveMfaEncryptionKey\(config, keyId\)/g)].length;
  assert.equal(resolveKeyCallSites, 3, 'verifyStepUpTotp, verifyLoginTotp, and confirmTotpEnrollment');
  assert.match(recoverPassword, /resolveMfaEncryptionKey\(config, keyId\)/);

  // Every one of those four call sites must catch CompromisedMfaKeyError and audit it -- never let it
  // propagate as an uncaught 500, and never silently swallow it without a record.
  // [\s\S]*? (not \s*) between the guard and the audit call, non-greedy: the guard is always
  // immediately followed by the audit call, but an explanatory comment (e.g. the neutral-error
  // rationale at the recover-password call site) may legitimately sit between them.
  const catchCompromised = /catch \(error\) \{\s*if \(!\(error instanceof CompromisedMfaKeyError\)\) throw error;[\s\S]*?await auditCompromisedMfaKeyRejection\(/g;
  assert.equal([...actions.matchAll(catchCompromised)].length, 3);
  assert.equal([...recoverPassword.matchAll(catchCompromised)].length, 1);

  // resolveMfaEncryptionKey itself must reject a compromised key before ever falling through to the
  // "unavailable" branch, and never touch the database (kept synchronous, matching
  // decryptTotpSecret's own contract) -- the audit write happens only at the call sites above.
  const resolver = totp.slice(totp.indexOf('export function resolveMfaEncryptionKey'));
  assert.ok(resolver.indexOf('compromisedKeyIds.has(keyId)') < resolver.indexOf('encryptionKeys.get(keyId)'));
  assert.doesNotMatch(resolver.slice(0, resolver.indexOf('\n}')), /await|db\.|sql`/);
  assert.match(audit, /auth\.mfa\.compromised_key_rejected/);
});

test('AUTH-REMEMBER-001: beginPrimaryMfa only reads MFA config/the remembered-device cookie for roles that could need TOTP, and feeds the real verification result to the shared decision, not a hardcoded false', () => {
  const login = source('lib/auth/mfa/login.ts');
  assert.match(login, /roleRequiresTotp\('privileged-users', role\)/);
  const guardedBlock = login.slice(login.indexOf("if (factor && roleRequiresTotp"), login.indexOf('const decision = decideMfa('));
  assert.match(guardedBlock, /mfaConfiguration\(\)/);
  assert.match(guardedBlock, /readRememberedTotpDeviceToken\(\)/);
  assert.match(guardedBlock, /verifyRememberedDevice\(\{/);
  assert.doesNotMatch(login, /rememberedDeviceValid: false/);
  assert.doesNotMatch(login, /rememberTotpDevice: false/);
  assert.match(login, /decision === 'not-required' \|\| decision === 'remembered-device-satisfied'/);
});

test('AUTH-REMEMBER-001: a remembered device is only ever issued after the TOTP code is actually accepted, and only when the policy is enabled', () => {
  const actions = source('app/(login)/mfa/actions.ts');
  const verify = actions.slice(actions.indexOf('export const verifyLoginTotp'), actions.indexOf('export async function beginLoginWebAuthn'));
  assert.ok(verify.indexOf("result.status !== 'accepted'") < verify.indexOf('issueRememberedDevice('));
  assert.match(verify, /remember === 'on' && config\.rememberedDevice\.enabled && config\.rememberedDevice\.digestSecret/);
  assert.ok(verify.indexOf('issueRememberedDevice(') < verify.indexOf('setRememberedTotpDeviceCookie('));
  assert.ok(verify.indexOf('setRememberedTotpDeviceCookie(') < verify.indexOf('await setSession(context.user)'));
});

test('AUTH-REMEMBER-001: the remember-this-device checkbox is only rendered for a live login challenge when the policy is enabled, never for step-up/enrollment/recovery', () => {
  const form = source('app/(login)/mfa/mfa-form.tsx');
  assert.match(form, /mode === 'challenge' && rememberDeviceEnabled/);
  const page = source('app/(login)/mfa/page.tsx');
  assert.match(page, /pending\.stage === 'challenge' \? mfaConfiguration\(\)\.rememberedDevice : undefined/);
});
