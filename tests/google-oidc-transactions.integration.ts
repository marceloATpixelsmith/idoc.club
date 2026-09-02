import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GoogleOidcError,
  completeGoogleOidcCallback,
  createGoogleAuthorizationRequest,
  type GoogleOidcConfig,
} from '../lib/auth/google-oidc-reference.ts';
import { googleOidcTransactionStore, purgeExpiredGoogleOauthTransactions } from '../lib/auth/google-oidc-store.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

const APPLICATION_ID = 'idoc.club';
const ORIGIN = 'http://127.0.0.1:3100';
const config: GoogleOidcConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  clientSecretVersion: 'v1',
  redirectUri: `${ORIGIN}/api/auth/google/callback`,
};

async function createTransaction(overrides: Partial<Parameters<typeof createGoogleAuthorizationRequest>[0]> = {}) {
  return createGoogleAuthorizationRequest({
    applicationId: APPLICATION_ID,
    applicationOrigin: ORIGIN,
    store: googleOidcTransactionStore,
    config,
    ...overrides,
  });
}

function stateFromAuthorizationUrl(url: string) {
  return new URL(url).searchParams.get('state')!;
}

async function callback(overrides: Partial<Parameters<typeof completeGoogleOidcCallback>[0]> = {}) {
  return completeGoogleOidcCallback({
    applicationId: APPLICATION_ID,
    applicationOrigin: ORIGIN,
    store: googleOidcTransactionStore,
    config,
    ...overrides,
  });
}

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof GoogleOidcError, `expected a GoogleOidcError, got ${String(error)}`);
    return error.code;
  }
  throw new Error('expected the promise to reject');
}

test.beforeEach(resetIdoc);
test.after(closeHarness);

test('a created transaction is persisted with a distinct random state, nonce, and PKCE verifier', async () => {
  const first = await createTransaction();
  const second = await createTransaction();
  const firstState = stateFromAuthorizationUrl(first.authorizationUrl);
  const secondState = stateFromAuthorizationUrl(second.authorizationUrl);
  assert.notEqual(firstState, secondState);

  const rows = await sql<{ state: string; nonce: string; code_verifier: string; consumed_at: Date | null }[]>`
    select state, nonce, code_verifier, consumed_at from idoc.google_oauth_transactions order by id`;
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].nonce, rows[1].nonce);
  assert.notEqual(rows[0].code_verifier, rows[1].code_verifier);
  assert.ok(rows.every((row) => row.consumed_at === null));
  // 32 random bytes base64url-encoded is 43 characters with no padding.
  assert.match(firstState, /^[A-Za-z0-9_-]{43}$/);
});

test('a transaction cannot be replayed: the second callback attempt with the same state is rejected before any token exchange', async () => {
  const { authorizationUrl } = await createTransaction();
  const state = stateFromAuthorizationUrl(authorizationUrl);

  // The first attempt is deliberately given no `code`, so it fails at the invalid_request check —
  // but only *after* store.consume() has already unconditionally marked the transaction consumed.
  assert.equal(await errorCode(callback({ state })), 'invalid_request');

  const [row] = await sql<{ consumed_at: Date | null }[]>`
    select consumed_at from idoc.google_oauth_transactions where state = ${state}`;
  assert.ok(row.consumed_at, 'the transaction must be consumed even though the request ultimately failed');

  // A second attempt with the same state, even supplying a code this time, is rejected as a replay
  // before any network call is attempted (no fetchImpl is supplied here, so a real fetch would throw
  // if this path were reached).
  assert.equal(await errorCode(callback({ state, code: 'irrelevant-because-replay-is-rejected-first' })), 'invalid_transaction');
});

test('an unknown/never-issued state is rejected as an invalid transaction', async () => {
  assert.equal(await errorCode(callback({ state: 'never-issued-state-value' })), 'invalid_transaction');
});

test('a missing state parameter is rejected as an invalid request', async () => {
  assert.equal(await errorCode(callback({ state: null })), 'invalid_request');
  assert.equal(await errorCode(callback({ state: undefined })), 'invalid_request');
});

test('an expired transaction is rejected even though it was never consumed', async () => {
  const nowMs = Date.now();
  const { authorizationUrl } = await createTransaction({ nowMs, ttlSeconds: 60 });
  const state = stateFromAuthorizationUrl(authorizationUrl);
  // Ask the callback to evaluate itself as though 61 seconds have passed.
  assert.equal(await errorCode(callback({ state, nowMs: nowMs + 61_000 })), 'expired_transaction');

  // The expiry check runs after consumption, so the transaction is now burned regardless of the
  // caller ever retrying with a "valid" clock.
  assert.equal(await errorCode(callback({ state, nowMs })), 'invalid_transaction');
});

test('a callback presented against a different application origin than the transaction was created for is rejected', async () => {
  const { authorizationUrl } = await createTransaction();
  const state = stateFromAuthorizationUrl(authorizationUrl);
  assert.equal(await errorCode(callback({ state, applicationOrigin: 'http://127.0.0.1:9999' })), 'invalid_transaction');
});

test('a callback presented with a redirect_uri the transaction was not bound to is rejected', async () => {
  const { authorizationUrl } = await createTransaction();
  const state = stateFromAuthorizationUrl(authorizationUrl);
  const mismatchedConfig: GoogleOidcConfig = { ...config, redirectUri: `${ORIGIN}/api/auth/google/attacker-callback` };
  assert.equal(await errorCode(callback({ state, config: mismatchedConfig })), 'invalid_transaction');
});

test('a provider-reported error is surfaced as provider_error without attempting a token exchange', async () => {
  const { authorizationUrl } = await createTransaction();
  const state = stateFromAuthorizationUrl(authorizationUrl);
  assert.equal(await errorCode(callback({ state, providerError: 'access_denied' })), 'provider_error');
});

test('an authentication-purpose transaction requires no authenticated user id, and a link-purpose transaction requires one, enforced at creation time', async () => {
  const user = await createUser();
  assert.equal(
    await errorCode(createTransaction({ purpose: 'authentication', authenticatedUserId: String(user.id) })),
    'configuration',
  );
  assert.equal(
    await errorCode(createTransaction({ purpose: 'external_identity_link', authenticatedUserId: null })),
    'configuration',
  );
  // The valid combinations succeed.
  await createTransaction({ purpose: 'authentication', authenticatedUserId: null });
  await createTransaction({ purpose: 'external_identity_link', authenticatedUserId: String(user.id) });
});

test('the database itself rejects a purpose/authenticated-user-id combination that violates the invariant, independent of application code', async () => {
  const user = await createUser();
  await assert.rejects(
    () => sql`insert into idoc.google_oauth_transactions
      (state, provider, application_id, application_origin, nonce, code_verifier, redirect_uri, return_to, purpose, authenticated_user_id, created_at, expires_at)
      values ('raw-sql-bypass-attempt', 'google', ${APPLICATION_ID}, ${ORIGIN}, 'n', 'v', ${config.redirectUri}, '/', 'authentication', ${user.id}, now(), now() + interval '15 minutes')`,
    /google_oauth_transactions_purpose_check|violates check constraint/i,
  );
  await assert.rejects(
    () => sql`insert into idoc.google_oauth_transactions
      (state, provider, application_id, application_origin, nonce, code_verifier, redirect_uri, return_to, purpose, authenticated_user_id, created_at, expires_at)
      values ('raw-sql-bypass-attempt-2', 'google', ${APPLICATION_ID}, ${ORIGIN}, 'n', 'v', ${config.redirectUri}, '/', 'external_identity_link', null, now(), now() + interval '15 minutes')`,
    /google_oauth_transactions_purpose_check|violates check constraint/i,
  );
});

test('a requested TTL beyond the maximum transaction lifetime is rejected', async () => {
  assert.equal(await errorCode(createTransaction({ ttlSeconds: 901 })), 'configuration');
  assert.equal(await errorCode(createTransaction({ ttlSeconds: 0 })), 'configuration');
  assert.equal(await errorCode(createTransaction({ ttlSeconds: -1 })), 'configuration');
  // The maximum itself is accepted.
  await createTransaction({ ttlSeconds: 900 });
});

test('the state, application id, and unique constraints are enforced by the database, not merely by application code', async () => {
  const { authorizationUrl } = await createTransaction();
  const state = stateFromAuthorizationUrl(authorizationUrl);
  await assert.rejects(
    () => sql`insert into idoc.google_oauth_transactions
      (state, provider, application_id, application_origin, nonce, code_verifier, redirect_uri, return_to, purpose, authenticated_user_id, created_at, expires_at)
      values (${state}, 'google', ${APPLICATION_ID}, ${ORIGIN}, 'other-nonce', 'other-verifier', ${config.redirectUri}, '/', 'authentication', null, now(), now() + interval '15 minutes')`,
    /duplicate key|unique constraint/i,
  );
});

test('purging expired/consumed transactions removes only rows past the retention window, real deletes proven against Postgres', async () => {
  const now = Date.now();
  // A transaction that expired long ago (outside the 24h retention window).
  const stale = await createTransaction({ nowMs: now - 25 * 60 * 60 * 1000, ttlSeconds: 60 });
  const staleState = stateFromAuthorizationUrl(stale.authorizationUrl);
  // A transaction that is still within the retention window.
  const recent = await createTransaction();
  const recentState = stateFromAuthorizationUrl(recent.authorizationUrl);

  await purgeExpiredGoogleOauthTransactions(new Date(now));

  const remaining = await sql<{ state: string }[]>`select state from idoc.google_oauth_transactions`;
  assert.deepEqual(remaining.map((row) => row.state).sort(), [recentState].sort());
  assert.ok(!remaining.some((row) => row.state === staleState));
});
