import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleOidcError, googleOauthClientSecretVersions, loadGoogleOidcConfig } from '../lib/auth/google-oidc-reference.ts';

// AUTH-SECRET-004: "OAuth client secrets MUST support verified bounded-overlap replacement,
// rollback, retirement and audit without client exposure." These tests drive the real production
// loadGoogleOidcConfig()/googleOauthClientSecretVersions() config parsing -- not a reimplementation
// -- proving the opt-in versioned rotation ring resolves, rolls back, and fails closed correctly,
// while a deployment that never rotates sees identical behavior to before this row existed.

const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://idoc.club/api/auth/google/callback',
};

test('a plain GOOGLE_OAUTH_CLIENT_SECRET (no rotation config) resolves as an implicit single-version ring, unchanged from before', () => {
  const config = loadGoogleOidcConfig({ ...base, GOOGLE_OAUTH_CLIENT_SECRET: 'plain-secret-value' });
  assert.equal(config.clientSecret, 'plain-secret-value');
  assert.equal(config.clientSecretVersion, 'v1');
  assert.deepEqual([...googleOauthClientSecretVersions({ ...base, GOOGLE_OAUTH_CLIENT_SECRET: 'plain-secret-value' })], [['v1', 'plain-secret-value']]);
});

test('the versioned rotation ring resolves the configured active version, with the prior version still present for rollback', () => {
  const environment = {
    ...base,
    GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS: JSON.stringify({ v1: 'old-secret', v2: 'new-secret' }),
    GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION: 'v2',
  };
  const config = loadGoogleOidcConfig(environment);
  assert.equal(config.clientSecret, 'new-secret');
  assert.equal(config.clientSecretVersion, 'v2');
  assert.deepEqual([...googleOauthClientSecretVersions(environment)], [['v1', 'old-secret'], ['v2', 'new-secret']]);
});

test('rollback is just reverting the active-version pointer -- the prior secret value never needs to be re-entered', () => {
  const versions = JSON.stringify({ v1: 'old-secret', v2: 'new-secret' });
  const rolledBack = loadGoogleOidcConfig({ ...base, GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS: versions, GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION: 'v1' });
  assert.equal(rolledBack.clientSecret, 'old-secret');
  assert.equal(rolledBack.clientSecretVersion, 'v1');
});

test('retirement is just removing an old version from the ring -- the app rejects an active-version pointer naming a version no longer present', () => {
  assert.throws(
    () => loadGoogleOidcConfig({
      ...base,
      GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS: JSON.stringify({ v2: 'new-secret' }), // v1 retired/removed
      GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION: 'v1',
    }),
    (error: unknown) => error instanceof GoogleOidcError && error.code === 'configuration',
  );
});

test('the rotation ring fails closed on malformed JSON, non-object shapes, empty maps, and non-string values', () => {
  for (const GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS of ['{', '[]', '"not-an-object"', '{}', JSON.stringify({ v1: 42 }), JSON.stringify({ v1: '' })]) {
    assert.throws(
      () => loadGoogleOidcConfig({ ...base, GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS, GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION: 'v1' }),
      (error: unknown) => error instanceof GoogleOidcError && error.code === 'configuration',
    );
  }
});

test('the rotation ring requires an explicit active version and rejects a malformed version label', () => {
  assert.throws(
    () => loadGoogleOidcConfig({ ...base, GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS: JSON.stringify({ v1: 'secret' }) }),
    (error: unknown) => error instanceof GoogleOidcError && error.code === 'configuration',
  );
  assert.throws(
    () => loadGoogleOidcConfig({ ...base, GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS: JSON.stringify({ 'not a valid label!': 'secret' }), GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION: 'not a valid label!' }),
    (error: unknown) => error instanceof GoogleOidcError && error.code === 'configuration',
  );
});
