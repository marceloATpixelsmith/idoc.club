import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const provider = read('lib/auth/google-oidc-reference.ts');
const store = read('lib/auth/google-oidc-store.ts');
const account = read('lib/auth/google-account.ts');
const migration = read('lib/db/migrations/0017_google_oidc.sql');
const login = read('app/(login)/sign-in/email-step.tsx');
const signup = read('app/(login)/sign-up/email-step.tsx');
const env = read('.env.example');

test('Google OIDC uses the canonical reference 1.10 provider security invariants', () => {
  assert.match(provider, /https:\/\/accounts\.google\.com/);
  assert.match(provider, /codeChallengeMethod: 'S256'/);
  assert.match(provider, /randomBytes\(32\)/);
  assert.match(provider, /state/);
  assert.match(provider, /nonce/);
  assert.match(provider, /applicationId/);
  assert.match(provider, /applicationOrigin/);
  assert.match(provider, /destination\.origin !== applicationOrigin/);
  assert.match(provider, /issuer: GOOGLE_OIDC_PROVIDER\.issuer/);
  assert.match(provider, /audience: config\.clientId/);
  assert.match(provider, /algorithms: \[\.\.\.GOOGLE_OIDC_PROVIDER\.idTokenAlgorithms\]/);
  assert.match(provider, /payload\.azp !== config\.clientId/);
});

test('Google OAuth transactions are persistent and atomically consumed', () => {
  assert.match(store, /insert into idoc\.google_oauth_transactions/);
  assert.match(store, /update idoc\.google_oauth_transactions/);
  assert.match(store, /and consumed_at is null/);
  assert.match(store, /set consumed_at = now\(\)/);
  assert.match(migration, /state varchar\(128\) not null unique/);
});

test('external identities use issuer plus subject and never auto-link existing email accounts', () => {
  assert.match(migration, /unique \(issuer, subject\)/);
  assert.match(account, /where issuer = \$\{identity\.issuer\}/);
  assert.match(account, /and subject = \$\{identity\.subject\}/);
  assert.match(account, /if \(existingUser\)/);
  assert.match(account, /throw new GoogleAccountLinkRequiredError\(\)/);
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
