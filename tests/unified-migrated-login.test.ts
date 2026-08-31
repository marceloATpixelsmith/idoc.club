import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('sign-in does not expose a migrated-member activation link', () => {
  const passwordStep = read('app/(login)/sign-in/password-step.tsx');
  assert.doesNotMatch(passwordStep, /Migrated member\?|request-activation/);
});

test('legacy activation fallback is not linked from normal sign-in', () => {
  const emailStep = read('app/(login)/sign-in/email-step.tsx');
  const passwordStep = read('app/(login)/sign-in/password-step.tsx');
  assert.doesNotMatch(`${emailStep}\n${passwordStep}`, /request-activation|Migrated member\?/);
});

test('anonymous login email entry is account-state neutral and password-first', () => {
  const actions = read('app/(login)/sign-in/actions.ts');
  const startLogin = actions.slice(actions.indexOf('export const startLogin'), actions.indexOf('const verifyOtpSchema'));
  assert.match(startLogin, /await startPendingLogin\(email\);\s*redirect\('\/sign-in'\);/);
  assert.doesNotMatch(startLogin, /issueEmailOtp|eligibleLoginOtpUser|migrated_pending/);
});

test('email verification is triggered only after successful password verification', () => {
  const actions = read('app/(login)/actions.ts');
  const signIn = actions.slice(actions.indexOf('export const signIn'), actions.indexOf('const accountLinkSchema'));
  const passwordCheck = signIn.indexOf('comparePasswords(password, foundUser.passwordHash)');
  const verificationBranch = signIn.indexOf('if (!foundUser.emailVerifiedAt)');
  const otpIssue = signIn.indexOf("issueEmailOtp(email, 'login_verification'");
  assert.ok(passwordCheck >= 0 && verificationBranch > passwordCheck && otpIssue > verificationBranch);
});

test('migrated members use the same password-first surface and validated activation boundary', () => {
  const page = read('app/(login)/sign-in/page.tsx');
  const actions = read('app/(login)/actions.ts');
  const verification = read('app/(login)/sign-in/actions.ts');
  assert.doesNotMatch(page, /ActivatePasswordStep|accountState|migrated_pending/);
  assert.match(actions, /foundUser\.accountState === 'migrated_pending'[\s\S]*requireLoginOtp\(email, foundUser\.id, foundUser\.sessionVersion, false\)/);
  assert.match(verification, /finalizeMigratedAccountAfterVerifiedPassword\(user\.id\)/);
  // AUTH-ERROR-003: the failure branch must use the policy-configured support contact, not a
  // hardcoded string with no way for an operator to point it at a real, monitored address.
  assert.match(verification, /Contact \$\{supportEmailForServer\(\)\} for help/);
});

test('compatibility activation remains support-only for imported accounts without a usable credential', () => {
  const requestPage = read('app/(login)/request-activation/page.tsx');
  const recovery = read('lib/membership/account-recovery.ts');
  assert.match(requestPage, /requestMigrationActivation/);
  assert.match(recovery, /Compatibility\/support entry point/);
  assert.match(recovery, /validateMigrationActivationFoundation/);
  assert.match(recovery, /applyMigrationActivationMutation/);
});
