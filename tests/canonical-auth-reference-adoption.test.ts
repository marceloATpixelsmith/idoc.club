import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const loginEntry = read('app/(login)/sign-in/email-step.tsx');
const loginActions = read('app/(login)/sign-in/actions.ts');
const sharedActions = read('app/(login)/actions.ts');
const loginPage = read('app/(login)/sign-in/page.tsx');
const authShell = read('components/auth/auth-shell.tsx');

test('login entry has no special migration or resend-verification UI', () => {
  assert.doesNotMatch(loginEntry, /Migrated member|Activate your account|Changed your email|request-activation|resendVerification/i);
});

test('anonymous login entry does not send email OTP before password', () => {
  const startLoginBody = loginActions.slice(loginActions.indexOf('export const startLogin'), loginActions.indexOf('const verifyOtpSchema'));
  assert.doesNotMatch(startLoginBody, /issueEmailOtp|eligibleLoginOtpUser|migrated_pending/);
  assert.match(startLoginBody, /startPendingLogin\(email, false\)/);
});

test('password success gates only unverified accounts into email verification', () => {
  const signInBody = sharedActions.slice(sharedActions.indexOf('export const signIn'), sharedActions.indexOf('const accountLinkSchema'));
  assert.match(signInBody, /comparePasswords\(password, foundUser\.passwordHash\)/);
  assert.match(signInBody, /if \(!foundUser\.emailVerifiedAt\)/);
  assert.match(signInBody, /issueEmailOtp\(email, 'login_verification'/);
  assert.match(signInBody, /startPendingLogin\(email, true\)/);
  assert.match(signInBody, /await setSession\(foundUser\)/);
});

test('successful login email verification persists authoritative state before session', () => {
  const verifyBody = loginActions.slice(loginActions.indexOf('export const verifyLoginOtp'), loginActions.indexOf('export const resendLoginOtp'));
  assert.match(verifyBody, /emailVerifiedAt:/);
  assert.match(verifyBody, /await setSession\(verifiedUser\)/);
  assert.ok(verifyBody.indexOf('emailVerifiedAt:') < verifyBody.indexOf('await setSession(verifiedUser)'));
});

test('sign-in routing is password-first and has no migrated activation branch', () => {
  assert.match(loginPage, /return <PasswordStep email=\{pending\.email\} \/>/);
  assert.doesNotMatch(loginPage, /ActivatePasswordStep|accountState|migrated_pending/);
});

test('auth shell follows canonical split layout and mobile visual behavior', () => {
  assert.match(authShell, /md:w-1\/2/);
  assert.match(authShell, /h-\[220px\]/);
  assert.match(authShell, /max-w-\[400px\]/);
  assert.match(authShell, /calc\(50% \+ 150px\) center/);
  assert.match(authShell, /\/idoc-logo\.svg/);
  assert.match(authShell, /\/auth-background\.jpg/);
});

test('canonical reference version is pinned in implementation documentation', () => {
  const doc = read('docs/13-canonical-auth-reference-retrofit.md');
  assert.match(doc, /contract 1\.9\.0/i);
  assert.match(doc, /schema 13\.0\.0/i);
  assert.match(doc, /validator 10\.0\.0/i);
});
