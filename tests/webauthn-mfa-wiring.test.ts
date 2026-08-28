import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(path, 'utf8');

test('primary login MFA computes WebAuthn availability from the store, never from client input, before setting the pending cookie', () => {
  const login = source('lib/auth/mfa/login.ts');
  assert.match(login, /const hasWebAuthn = \(await webauthnStore\.getActiveCredentials\(subjectId, MFA_APPLICATION_ID\)\)\.length > 0;/);
  assert.match(login, /setPendingPrimaryAuth\(\{ applicationId: MFA_APPLICATION_ID, factorId: factor\.factorId, hasWebAuthn,/);
  assert.match(login, /setPendingPrimaryAuth\(\{ applicationId: MFA_APPLICATION_ID, factorId: enrollment\.factorId, hasWebAuthn: false,/);
});

test('the pending-primary-auth cookie strictly validates hasWebAuthn is boolean before trusting it', () => {
  const pending = source('lib/auth/mfa/pending-primary-auth.ts');
  assert.match(pending, /hasWebAuthn: boolean;/);
  assert.match(pending, /typeof payload\.hasWebAuthn !== 'boolean'/);
});

test('login-time WebAuthn actions require the pending challenge to have offered a passkey and never trust a factorId supplied outside that binding', () => {
  const actions = source('app/(login)/mfa/actions.ts');
  assert.match(actions, /export async function beginLoginWebAuthn\(\)/);
  assert.match(actions, /if \(!context \|\| !context\.pending\.hasWebAuthn\) throw new Error/);
  assert.match(actions, /export const verifyLoginWebAuthn = validatedAction\(webAuthnResponseSchema/);
  const verifyLoginWebAuthn = actions.slice(actions.indexOf('export const verifyLoginWebAuthn'), actions.indexOf('export const beginAuthenticatorRecovery'));
  assert.match(verifyLoginWebAuthn, /if \(!context \|\| !context\.pending\.hasWebAuthn\) return failAndRestart/);
  assert.match(verifyLoginWebAuthn, /allowed\(context\.user\.id, 'mfa_login_verify'\)/);
  assert.match(verifyLoginWebAuthn, /finishWebAuthnAuthentication\(/);
  assert.match(verifyLoginWebAuthn, /mfaStore\.acceptChallengeWithVerifiedFactor\(/);
  assert.match(verifyLoginWebAuthn, /purpose: 'login'/);
  assert.match(verifyLoginWebAuthn, /setSession\(context\.user\)/);
});

test('step-up WebAuthn verification grants authority bound to the WebAuthn factor and method, not the TOTP factor recorded on the pending challenge', () => {
  const actions = source('app/(login)/mfa/actions.ts');
  const verifyStepUpWebAuthn = actions.slice(actions.indexOf('export const verifyStepUpWebAuthn'), actions.length);
  assert.match(verifyStepUpWebAuthn, /if \(!context \|\| !context\.hasWebAuthn\) return \{ error:/);
  assert.match(verifyStepUpWebAuthn, /finishWebAuthnAuthentication\(/);
  assert.match(verifyStepUpWebAuthn, /purpose: 'step-up'/);
  assert.match(verifyStepUpWebAuthn, /grantFreshStepUp\(context\.pending, \{ factorId: verification\.factorId, method: 'webauthn' \}\)/);
  const verifyStepUpTotp = actions.slice(actions.indexOf('export const verifyStepUpTotp'), actions.indexOf('export async function beginStepUpWebAuthn'));
  assert.match(verifyStepUpTotp, /grantFreshStepUp\(context\.pending, \{ factorId: context\.pending\.factorId, method: 'totp' \}\)/);
});

test('requireFreshStepUp accepts either a fresh TOTP or a fresh WebAuthn proof of the same policy-required factor', () => {
  const stepUp = source('lib/auth/mfa/step-up.ts');
  assert.match(stepUp, /const hasFreshWebAuthn = Boolean\(fresh && fresh\.method === 'webauthn'/);
  assert.match(stepUp, /if \(!freshnessRequired && !hasFreshTotp && !hasFreshWebAuthn\) return \{ required: false as const \};/);
  assert.match(stepUp, /if \(\(hasFreshTotp \|\| hasFreshWebAuthn\) && fresh\) \{/);
  assert.match(stepUp, /factorId: fresh\.factorId, nowMs: Date\.now\(\), subjectId: String\(user\.id\), transactionId: fresh\.transactionId/);
});

test('passkey registration and removal are privileged, require an active TOTP fallback, and are gated behind fresh step-up for the change-mfa action', () => {
  const security = source('app/(dashboard)/dashboard/security/actions.ts');
  const registration = security.slice(security.indexOf('export const beginPasskeyRegistration'), security.indexOf('const finishPasskeySchema'));
  assert.match(registration, /await privilegedUser\(user\)/);
  assert.match(registration, /requireFreshStepUp\(user, 'change-mfa', '\/dashboard\/security'\)/);
  assert.match(registration, /const factor = await mfaStore\.getActiveTotp\(String\(user\.id\), MFA_APPLICATION_ID\);/);
  assert.match(registration, /if \(!factor\) return \{ error: 'Set up an authenticator app before adding a passkey\.' \};/);
  const removal = security.slice(security.indexOf('export const removePasskeyCredential'), security.length);
  assert.match(removal, /await privilegedUser\(user\)/);
  assert.match(removal, /requireFreshStepUp\(user, 'change-mfa', '\/dashboard\/security'\)/);
});

test('a completed passkey registration and a removal each write an audit entry and enqueue a distinct notification kind', () => {
  const security = source('app/(dashboard)/dashboard/security/actions.ts');
  const finish = security.slice(security.indexOf('export const finishPasskeyRegistration'), security.indexOf('const removePasskeySchema'));
  assert.match(finish, /audit\(user\.id, 'auth\.mfa\.passkey\.registered', 'passkey'\)/);
  assert.match(finish, /kind: 'passkey_registered'/);
  const removal = security.slice(security.indexOf('export const removePasskeyCredential'), security.length);
  assert.match(removal, /audit\(user\.id, 'auth\.mfa\.passkey\.removed', 'passkey'\)/);
  assert.match(removal, /kind: 'passkey_removed'/);
  const events = source('lib/notifications/auth-security-events.ts');
  assert.match(events, /'passkey_registered', 'passkey_removed'/);
});

test('WebAuthn credential storage never reuses TOTP secret material or its verification mechanics', () => {
  const schema = source('lib/db/schema.ts');
  assert.match(schema, /mfa_factors_totp_secret_check/);
  assert.doesNotMatch(source('lib/auth/mfa/webauthn-store.ts'), /encryptedSecret|encryptTotpSecret|decryptTotpSecret|totpCounter|verifyTotpCode/);
  assert.doesNotMatch(source('lib/auth/mfa/webauthn.ts'), /encryptedSecret|encryptTotpSecret|decryptTotpSecret|totpCounter|verifyTotpCode/);
});

test('every WebAuthn ceremony requires user verification and is bound to the configured relying-party origin and ID', () => {
  const webauthn = source('lib/auth/mfa/webauthn.ts');
  assert.match(webauthn, /requireUserVerification: true/g);
  assert.equal((webauthn.match(/requireUserVerification: true/g) ?? []).length, 2);
  assert.match(webauthn, /expectedOrigin,/);
  assert.match(webauthn, /expectedRPID: rpID/);
});
