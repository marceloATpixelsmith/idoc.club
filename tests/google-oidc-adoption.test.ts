import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const provider = read('lib/auth/google-oidc-reference.ts');
const store = read('lib/auth/google-oidc-store.ts');
const binding = read('lib/auth/google-oauth-browser-binding.ts');
const account = read('lib/auth/google-account.ts');
const linking = read('lib/auth/google-identity-linking.ts');
const evidence = read('lib/auth/google-identity-link-evidence.ts');
const migration = read('lib/db/migrations/0017_google_oidc.sql');
const linkingMigration = read('lib/db/migrations/0018_external_identity_linking.sql');
const startRoute = read('app/api/auth/google/start/route.ts');
const linkStartRoute = read('app/api/auth/google/link/start/route.ts');
const callbackRoute = read('app/api/auth/google/callback/route.ts');
const rateLimit = read('lib/security/rate-limit.ts');
const login = read('app/(login)/sign-in/email-step.tsx');
const signup = read('app/(login)/sign-up/email-step.tsx');
const signupPage = read('app/(login)/sign-up/page.tsx');
const intentModule = read('lib/auth/google-oauth-intent.ts');
const env = read('.env.example');

test('Google OIDC uses the canonical reference 1.10 provider security invariants', () => {
  assert.match(provider, /https:\/\/accounts\.google\.com/);
  assert.match(provider, /codeChallengeMethod: 'S256'/);
  assert.match(provider, /const state = randomBase64Url\(32\)/);
  assert.match(provider, /const nonce = randomBase64Url\(32\)/);
  assert.match(provider, /const codeVerifier = randomBase64Url\(48\)/);
  assert.match(provider, /applicationId/);
  assert.match(provider, /applicationOrigin/);
  assert.match(provider, /destination\.origin !== applicationOrigin/);
  assert.match(provider, /issuer: provider\.issuer/);
  assert.match(provider, /audience: config\.clientId/);
  assert.match(provider, /algorithms: \[\.\.\.GOOGLE_OIDC_PROVIDER\.idTokenAlgorithms\]/);
  assert.match(provider, /payload\.azp !== config\.clientId/);
});

test('Google OAuth state is bound to the initiating browser before callback consumption', () => {
  assert.match(binding, /createHmac\('sha256', authSecretForServer\(\)\)/);
  assert.match(binding, /httpOnly: true/);
  assert.match(binding, /sameSite: 'lax'/);
  assert.match(startRoute, /createGoogleOauthBrowserBinding\(state\)/);
  assert.match(startRoute, /response\.cookies\.set/);
  const verify = callbackRoute.indexOf('if (!state || !verifyGoogleOauthBrowserBinding(binding, state))');
  const consume = callbackRoute.indexOf('const identity = await completeGoogleOidcCallback({');
  assert.ok(verify >= 0 && consume > verify, 'browser binding must be verified before OAuth transaction consumption');
});

test('Google OAuth transactions are persistent, atomically consumed, rate limited, and retained for a bounded period', () => {
  assert.match(store, /insert into idoc\.google_oauth_transactions/);
  assert.match(store, /update idoc\.google_oauth_transactions/);
  assert.match(store, /and consumed_at is null/);
  assert.match(store, /set consumed_at = now\(\)/);
  assert.match(store, /delete from idoc\.google_oauth_transactions/);
  assert.match(store, /RETENTION_MILLISECONDS = 24 \* 60 \* 60 \* 1000/);
  assert.match(startRoute, /checkOriginRateLimit\('google_oauth_start'/);
  assert.match(startRoute, /purgeExpiredGoogleOauthTransactions\(\)/);
  assert.match(rateLimit, /export async function checkOriginRateLimit/);
  assert.match(migration, /state varchar\(128\) not null unique/);
});

test('external identities use issuer plus subject and never auto-link existing email accounts', () => {
  assert.match(migration, /unique \(issuer, subject\)/);
  assert.match(account, /where issuer = \$\{identity\.issuer\}/);
  assert.match(account, /and subject = \$\{identity\.subject\}/);
  assert.match(account, /if \(existingUser\)/);
  assert.match(account, /throw new GoogleAccountLinkRequiredError\(\)/);
});

test('explicit Google linking is bound to the authenticated user and fresh password verification', () => {
  assert.match(provider, /purpose = 'authentication'/);
  assert.match(provider, /authenticatedUserId = null/);
  assert.match(provider, /purpose === 'external_identity_link' && !authenticatedUserId/);
  assert.match(linkStartRoute, /purpose: 'external_identity_link'/);
  assert.match(linkStartRoute, /authenticatedUserId: String\(user\.id\)/);
  assert.match(callbackRoute, /identity\.oauthAuthenticatedUserId !== String\(user\.id\)/);
  assert.match(evidence, /GOOGLE_LINK_FRESH_AUTH_MAX_AGE_MS = 5 \* 60 \* 1000/);
  assert.match(evidence, /httpOnly: true/);
  assert.match(linking, /oauthTransactionPurpose !== 'external_identity_link'/);
  assert.match(linking, /oauthAuthenticatedUserId !== input\.userId/);
  assert.match(linking, /pg_advisory_xact_lock/);
  assert.match(linkingMigration, /purpose varchar\(40\) not null default 'authentication'/);
  assert.match(linkingMigration, /authenticated_user_id integer references idoc\.users/);
});

test('link and unlink persist audit evidence and security notification outbox records atomically', () => {
  assert.match(linking, /client\.begin/);
  assert.match(linking, /auth\.google_identity\.linked/);
  assert.match(linking, /auth\.google_identity\.unlinked/);
  assert.match(linking, /auth_security_notification_outbox/);
  assert.match(linkingMigration, /auth_security_notification_outbox/);
});

test('Google buttons point to the canonical start route, tagged with the page the user started from so a failure can send them back to it', () => {
  assert.match(login, /googleHref="\/api\/auth\/google\/start\?intent=login"/);
  assert.match(signup, /googleHref="\/api\/auth\/google\/start\?intent=signup"/);
});

test('an unexpected start-route failure (no GoogleOidcError.code) still names which phase broke, without logging the exception itself', () => {
  assert.match(startRoute, /let phase: 'transaction_purge' \| 'authorization_request' = 'transaction_purge';/);
  assert.match(startRoute, /phase = 'authorization_request';[\s\S]*?createGoogleAuthorizationRequest\(/);
  const catchBody = startRoute.slice(startRoute.indexOf('} catch (error) {'));
  assert.match(catchBody, /const reason = error instanceof GoogleOidcError \? error\.code : `unexpected_error:\$\{phase\}`;/);
  // Still only a fixed, coarse category interpolated in -- never the error object/message itself.
  assert.doesNotMatch(catchBody, /error\.message|String\(error\)|error\.stack/);
});

test('a Google failure sends the user back to the page they started from, not always to sign-in', () => {
  // The start route reads ?intent from the button href and stores it in a cookie, so it survives
  // the round trip through Google even if the transaction is never created (e.g. rate limited).
  assert.match(startRoute, /parseGoogleOauthIntent\(request\.nextUrl\.searchParams\.get\('intent'\)\)/);
  assert.match(startRoute, /googleOauthFailureRedirectPath\(intent\)/);
  assert.match(startRoute, /response\.cookies\.set\(googleOauthIntentCookieName\(\), intent, googleOauthIntentCookieOptions\(\)\)/);

  // The callback route reads the cookie -- before the binding-cookie check, so even that failure
  // (the very first thing that can go wrong on the return leg) redirects to the right page -- and
  // clears it alongside the binding cookie on every exit.
  const beforeBindingCheck = callbackRoute.slice(
    callbackRoute.indexOf('export async function GET'),
    callbackRoute.indexOf('if (!state || !verifyGoogleOauthBrowserBinding'),
  );
  assert.match(beforeBindingCheck, /parseGoogleOauthIntent\(request\.cookies\.get\(googleOauthIntentCookieName\(\)\)\?\.value\)/);
  assert.match(callbackRoute, /function clearBinding\(response: NextResponse\) \{[\s\S]*?googleOauthIntentCookieName[\s\S]*?\}/);

  const catchBody = callbackRoute.slice(callbackRoute.lastIndexOf('} catch (error) {'));
  assert.match(catchBody, /googleOauthFailureRedirectPath\(intent\)/);
  // The one deliberate exception: an existing password account that needs linking always sends
  // the user to sign-in (with the "sign in with your password first" message), regardless of
  // which page they started from -- that is the actually-correct next step for that case.
  assert.match(catchBody, /GoogleAccountLinkRequiredError\) \{[\s\S]*?'\/sign-in\?google=link-required'/);
});

test('the Google OAuth intent cookie only ever steers a redirect -- signup is the only non-default value, everything else falls back to login', () => {
  assert.match(intentModule, /value === 'signup' \? 'signup' : 'login'/);
  assert.match(intentModule, /intent === 'signup' \? '\/sign-up' : '\/sign-in'/);
});

test('the sign-up page surfaces a Google failure inline instead of silently dropping it', () => {
  assert.match(signupPage, /searchParams/);
  assert.match(signupPage, /initialError=\{googleErrorMessage\(params\.google\)\}/);
});

test('deployment environment contract uses the canonical variable names', () => {
  assert.match(env, /^GOOGLE_OAUTH_CLIENT_ID=/m);
  assert.match(env, /^GOOGLE_OAUTH_CLIENT_SECRET=/m);
  assert.match(env, /^GOOGLE_OAUTH_REDIRECT_URI=/m);
});

// The security-e2e suite (tests/security-e2e/google-oauth.spec.ts) needs a way to point this module
// at a local mock IdP instead of real Google, so it can drive the actual start/callback routes
// end-to-end. This test guards the safety gate around that override -- a mistake here would make a
// test-only escape hatch reachable in production, not just weaken a test.
test('the test-provider override is gated so it can never resolve anywhere but a local mock server', () => {
  assert.match(provider, /function resolveGoogleOidcProvider\(/);
  assert.match(provider, /if \(!testBaseUrl \|\| env\.VERCEL\) return GOOGLE_OIDC_PROVIDER;/);
  assert.match(provider, /url\.hostname === 'localhost' \|\| url\.hostname === '127\.0\.0\.1' \|\| url\.hostname === '::1'/);
  assert.match(provider, /if \(url\.protocol !== 'http:' \|\| !isLoopback\) return GOOGLE_OIDC_PROVIDER;/);
});
