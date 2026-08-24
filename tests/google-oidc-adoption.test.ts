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
  assert.match(provider, /issuer: GOOGLE_OIDC_PROVIDER\.issuer/);
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

test('Google buttons point to the canonical start route', () => {
  assert.match(login, /googleHref="\/api\/auth\/google\/start"/);
  assert.match(signup, /googleHref="\/api\/auth\/google\/start"/);
});

test('deployment environment contract uses the canonical variable names', () => {
  assert.match(env, /^GOOGLE_OAUTH_CLIENT_ID=/m);
  assert.match(env, /^GOOGLE_OAUTH_CLIENT_SECRET=/m);
  assert.match(env, /^GOOGLE_OAUTH_REDIRECT_URI=/m);
});
