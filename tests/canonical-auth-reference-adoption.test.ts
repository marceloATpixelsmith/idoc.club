import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const assertContains = (source: string, pattern: RegExp, message: string) => {
  assert.ok(pattern.test(source), message);
};

const loginEntry = read('app/(login)/sign-in/email-step.tsx');
const loginPassword = read('app/(login)/sign-in/password-step.tsx');
const loginActions = read('app/(login)/sign-in/actions.ts');
const sharedActions = read('app/(login)/actions.ts');
const loginPage = read('app/(login)/sign-in/page.tsx');
const authShell = read('components/auth/auth-shell.tsx');
const authStyles = read('components/auth/canonical-reference.css');
const emailEntry = read('components/auth/email-entry-step.tsx');
const turnstile = read('components/turnstile-widget.tsx');

test('login entry has no special migration or resend-verification UI', () => {
  assert.doesNotMatch(loginEntry, /Migrated member|Activate your account|Changed your email|request-activation|resendVerification/i);
});

test('anonymous login entry does not send email OTP before password', () => {
  const startLoginBody = loginActions.slice(loginActions.indexOf('export const startLogin'), loginActions.indexOf('const verifyOtpSchema'));
  assert.doesNotMatch(startLoginBody, /issueEmailOtp|eligibleLoginOtpUser|migrated_pending/);
  assert.match(startLoginBody, /startPendingLogin\(email\)/);
});

test('password success gates ordinary returning accounts into login verification or device trust', () => {
  const signInBody = sharedActions.slice(sharedActions.indexOf('export const signIn'), sharedActions.indexOf('const accountLinkSchema'));
  assert.match(signInBody, /comparePasswords\(password, foundUser\.passwordHash\)/);
  assert.match(signInBody, /if \(!foundUser\.emailVerifiedAt\)/);
  assert.match(signInBody, /issueEmailOtp\(email, 'login_verification'/);
  assert.match(signInBody, /requireLoginOtp\(email, foundUser\.id, foundUser\.sessionVersion/);
  assert.match(signInBody, /hasValidLoginDeviceTrust\(foundUser\)/);
  assert.match(signInBody, /await setSession\(foundUser\)/);
});

test('successful login email verification persists authoritative state before session', () => {
  const verifyBody = loginActions.slice(loginActions.indexOf('export const verifyLoginOtp'), loginActions.indexOf('export const resendLoginOtp'));
  assert.match(verifyBody, /emailVerifiedAt:/);
  assert.match(verifyBody, /finalizeMigratedAccountAfterVerifiedPassword/);
  assert.match(verifyBody, /await setSession\(verifiedUser\)/);
  assert.ok(verifyBody.indexOf('emailVerifiedAt:') < verifyBody.indexOf('await setSession(verifiedUser)'));
});

test('sign-in routing remains password-first and has no migrated activation branch', () => {
  assert.match(loginPage, /return <PasswordStep email=\{pending\.email\} pendingCsrfNonce=\{pending\.csrfNonce\} \/>/);
  assert.doesNotMatch(loginPage, /ActivatePasswordStep|accountState|migrated_pending/);
});

test('login email screen uses canonical reference copy and action structure', () => {
  assert.match(loginEntry, /title="Login"/);
  assert.match(loginEntry, /submitLabel="Sign In"/);
  assert.match(loginEntry, />Create an account</);
  assert.match(loginEntry, />Forgot password\?</);
  assert.match(loginEntry, /dividerLabel="or continue with"/);
  assert.match(loginEntry, /showGoogle/);
  assert.match(loginEntry, /googleHref="\/api\/auth\/google\/start\?intent=login"/);
  assert.match(emailEntry, />Email Address</);
  assert.match(emailEntry, /you@example\.com/);
  assert.match(emailEntry, /Continue with Google/);
});

test('login password screen uses canonical identity row, labels, and actions', () => {
  assert.match(loginPassword, /Signing in as/);
  assert.match(loginPassword, />Change</);
  assert.match(loginPassword, /label="Password"/);
  assert.match(loginPassword, /Sign In/);
  assert.match(loginPassword, />Forgot password\?</);
  assert.doesNotMatch(loginPassword, /Forgot your password\?/);
});

test('auth shell follows canonical split layout and mobile visual behavior', () => {
  assert.match(authShell, /idoc-auth-shell__visual/);
  assert.match(authShell, /idoc-auth-shell__content/);
  assert.match(authShell, /\/idoc-logo\.svg/);
  assert.match(authStyles, /flex: 0 0 50%/);
  assert.match(authStyles, /max-width: 400px/);
  assert.match(authStyles, /height: 220px/);
  assert.match(authStyles, /calc\(50% \+ 150px\) center/);
});

test('canonical field and button geometry stays at the reference 48px height', () => {
  assert.match(authStyles, /\.idoc-auth-input[\s\S]*height: 48px/);
  assert.match(authStyles, /\.idoc-auth-button,[\s\S]*height: 48px/);
  assert.match(authStyles, /border-radius: 10px/);
});

test('real Turnstile stays flexible and is forced to the canonical light theme', () => {
  assert.match(turnstile, /size: 'flexible'/);
  assert.match(turnstile, /theme: 'light'/);
  assert.match(turnstile, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.match(turnstile, /challenges\.cloudflare\.com\/turnstile/);
});

test('canonical reference version is pinned in implementation documentation', () => {
  const doc = read('docs/13-canonical-auth-reference-retrofit.md');
  assertContains(doc, /contract\s+`?2\.0\.0`?/i, 'docs/13 must pin canonical auth contract 2.0.0');
  assertContains(doc, /schema\s+`?14\.0\.0`?/i, 'docs/13 must pin canonical auth schema 14.0.0');
  assertContains(doc, /validator\s+`?11\.0\.0`?/i, 'docs/13 must pin canonical auth validator 11.0.0');
});

test('product roadmap tracks Google OIDC as enabled Release 1 scope with explicit remaining launch gates', () => {
  const roadmap = read('docs/08-product-roadmap-and-functional-requirements.md');
  assertContains(roadmap, /Google OIDC is part of the Release 1 authentication scope/, 'docs/08 must keep Google OIDC in Release 1 scope');
  assertContains(roadmap, /browser-bound login-CSRF protection/, 'docs/08 must retain browser-bound Google login-CSRF protection');
  assertContains(roadmap, /existing-account Google linking must have an explicit authenticated\/fresh-verification flow/, 'docs/08 must keep the explicit fresh-verification Google-linking gate');
  assertContains(roadmap, /canonical privileged-MFA enforcement after Google primary authentication/, 'docs/08 must record privileged MFA after Google primary authentication');
  assertContains(roadmap, /Automatic email-only linking remains prohibited/, 'docs/08 must keep automatic email-only linking prohibited');
});
