import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export type GoogleOidcConfig = {
  clientId: string;
  clientSecret: string;
  /** Non-secret label identifying which configured version of the client secret is currently
   * active (see googleOauthClientSecret below) -- safe to log/audit, unlike clientSecret itself. */
  clientSecretVersion: string;
  redirectUri: string;
};

export type GoogleOidcTransactionPurpose = 'authentication' | 'external_identity_link';

export type GoogleOidcTransaction = {
  provider: 'google';
  applicationId: string;
  applicationOrigin: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  purpose: GoogleOidcTransactionPurpose;
  authenticatedUserId: string | null;
  createdAtMs: number;
  expiresAtMs: number;
};

export type GoogleOidcTransactionStore = {
  create: (transaction: GoogleOidcTransaction) => Promise<void>;
  consume: (state: string) => Promise<GoogleOidcTransaction | null>;
};

export type GoogleOidcIdentity = {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  returnTo: string;
  oauthTransactionPurpose: GoogleOidcTransactionPurpose;
  oauthAuthenticatedUserId: string | null;
};

export type GoogleAuthorizationRequest = {
  authorizationUrl: string;
  expiresAtMs: number;
};

export type GoogleOidcErrorCode =
  | 'configuration'
  | 'invalid_request'
  | 'invalid_transaction'
  | 'expired_transaction'
  | 'provider_error'
  | 'token_exchange_failed'
  | 'invalid_id_token';

export class GoogleOidcError extends Error {
  readonly code: GoogleOidcErrorCode;

  constructor(code: GoogleOidcErrorCode) {
    super('Google authentication could not be completed.');
    this.name = 'GoogleOidcError';
    this.code = code;
  }
}

export const GOOGLE_OIDC_PROVIDER = {
  id: 'google',
  issuer: 'https://accounts.google.com',
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  scopes: ['openid', 'email', 'profile'],
  responseType: 'code',
  responseMode: 'query',
  codeChallengeMethod: 'S256',
  idTokenAlgorithms: ['RS256'],
} as const;

export const GOOGLE_OAUTH_ENV = {
  clientId: 'GOOGLE_OAUTH_CLIENT_ID',
  clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET',
  clientSecretActiveVersion: 'GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION',
  clientSecretVersions: 'GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS',
  redirectUri: 'GOOGLE_OAUTH_REDIRECT_URI',
} as const;

export const GOOGLE_OIDC_TEST_PROVIDER_BASE_URL_ENV = 'GOOGLE_OIDC_TEST_PROVIDER_BASE_URL';

/** Resolves which OIDC provider (real Google, or a local mock IdP) this process talks to. Real
 * Google is the only possible answer unless every one of these holds: the override env var is set,
 * it parses as a plain-http loopback URL (never a real host -- a mock IdP has no reason to run
 * anywhere else), and `VERCEL` is unset (Vercel always sets this in every build/runtime environment,
 * so a value accidentally left in a deployment's env is still inert there). This is deliberately not
 * gated on `NODE_ENV === 'test'`: `next dev` hardcodes `NODE_ENV=development` in the very process
 * the security-e2e suite drives, so that gate would never actually activate for a real browser-level
 * OAuth test running against the dev server. The loopback-URL requirement carries the same weight
 * NODE_ENV would have: production never runs on localhost. */
type GoogleOidcProvider = Omit<typeof GOOGLE_OIDC_PROVIDER, 'authorizationEndpoint' | 'issuer' | 'jwksUri' | 'tokenEndpoint'> & {
  authorizationEndpoint: string;
  issuer: string;
  jwksUri: string;
  tokenEndpoint: string;
};

export function resolveGoogleOidcProvider(env: NodeJS.ProcessEnv = process.env): GoogleOidcProvider {
  const testBaseUrl = env[GOOGLE_OIDC_TEST_PROVIDER_BASE_URL_ENV]?.trim();
  if (!testBaseUrl || env.VERCEL) return GOOGLE_OIDC_PROVIDER;

  let url: URL;
  try {
    url = new URL(testBaseUrl);
  } catch {
    return GOOGLE_OIDC_PROVIDER;
  }
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'http:' || !isLoopback) return GOOGLE_OIDC_PROVIDER;

  return {
    ...GOOGLE_OIDC_PROVIDER,
    issuer: url.origin,
    authorizationEndpoint: `${url.origin}/o/oauth2/v2/auth`,
    tokenEndpoint: `${url.origin}/token`,
    jwksUri: `${url.origin}/certs`,
  };
}

export const GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS = 900;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new GoogleOidcError('configuration');
  return value;
}

function validRedirectUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GoogleOidcError('configuration');
  }

  const isLocalHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !isLocalHttp) throw new GoogleOidcError('configuration');
  if (url.username || url.password || url.hash) throw new GoogleOidcError('configuration');
  return url.toString();
}

// AUTH-SECRET-004: "OAuth client secrets MUST support verified bounded-overlap replacement,
// rollback, retirement and audit without client exposure." Google's own console already provides
// the actual overlap window during rotation (a newly generated secret and the prior one both stay
// valid there for a configurable period) -- what this app needs to support safely is configuring
// across that window: both the incoming and the about-to-be-retired secret present at once
// (bounded-overlap replacement), reverting to the prior one instantly if the new one turns out to be
// wrong (rollback), and removing an old one once confident it is no longer needed (retirement) --
// all without ever needing to re-enter or rediscover a secret value to do so, and the app only ever
// sends the one active version to Google (there is no "try several" verification the way a signing
// key ring needs, since the app is never the one validating this credential). A deployment that
// never rotates needs nothing new: GOOGLE_OAUTH_CLIENT_SECRET alone is returned as an implicit
// single-version ring, unchanged from before this row existed.
// GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS + _ACTIVE_VERSION is the opt-in rotation-ready form.
// google-oidc-secret-audit.ts provides the secret-free audit record of when the active version last
// changed. The Super Admin security operation calls it after a real cutover/sign-in; a CLI remains
// available as a non-browser operational fallback.
export function googleOauthClientSecretVersions(env: NodeJS.ProcessEnv = process.env): { activeVersion: string; versions: ReadonlyMap<string, string> } {
  const { version, versions } = googleOauthClientSecret(env);
  return { activeVersion: version, versions };
}

/** Requires the explicit rotation-ready ring. The legacy single-secret form deliberately receives
 * an implicit `v1` only for runtime compatibility; it is not auditable rotation evidence. */
export function explicitGoogleOauthClientSecretVersions(
  env: NodeJS.ProcessEnv = process.env,
): { activeVersion: string; versions: ReadonlyMap<string, string> } {
  if (
    !env[GOOGLE_OAUTH_ENV.clientSecretVersions]?.trim()
    || !env[GOOGLE_OAUTH_ENV.clientSecretActiveVersion]?.trim()
  ) throw new GoogleOidcError('configuration');
  return googleOauthClientSecretVersions(env);
}

function googleOauthClientSecret(env: NodeJS.ProcessEnv): { secret: string; version: string; versions: ReadonlyMap<string, string> } {
  const versionsRaw = env[GOOGLE_OAUTH_ENV.clientSecretVersions]?.trim();
  if (!versionsRaw) {
    // A lone GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION with no matching VERSIONS map is not "use
    // the legacy secret" -- it is a botched or partial rotation deploy (the ring was removed, or
    // never added, while the pointer still names a version) and must fail closed rather than
    // silently authenticating with a possibly-obsolete or revoked credential.
    if (env[GOOGLE_OAUTH_ENV.clientSecretActiveVersion]?.trim()) throw new GoogleOidcError('configuration');
    const secret = required(env, GOOGLE_OAUTH_ENV.clientSecret);
    return { secret, version: 'v1', versions: new Map([['v1', secret]]) };
  }
  let serialized: unknown;
  try { serialized = JSON.parse(versionsRaw); } catch { throw new GoogleOidcError('configuration'); }
  if (!serialized || Array.isArray(serialized) || typeof serialized !== 'object') throw new GoogleOidcError('configuration');
  const versions = new Map<string, string>();
  for (const [version, secret] of Object.entries(serialized)) {
    if (!/^[A-Za-z0-9_-]{1,30}$/.test(version) || typeof secret !== 'string' || !secret) throw new GoogleOidcError('configuration');
    versions.set(version, secret);
  }
  if (versions.size === 0) throw new GoogleOidcError('configuration');
  const activeVersion = required(env, GOOGLE_OAUTH_ENV.clientSecretActiveVersion);
  const secret = versions.get(activeVersion);
  if (!secret) throw new GoogleOidcError('configuration');
  return { secret, version: activeVersion, versions };
}

export function loadGoogleOidcConfig(env: NodeJS.ProcessEnv = process.env): GoogleOidcConfig {
  const { secret, version } = googleOauthClientSecret(env);
  return {
    clientId: required(env, GOOGLE_OAUTH_ENV.clientId),
    clientSecret: secret,
    clientSecretVersion: version,
    redirectUri: validRedirectUri(required(env, GOOGLE_OAUTH_ENV.redirectUri)),
  };
}

// Keyed by JWKS URI rather than a single load-time singleton, so a resolved test provider (a local
// mock IdP, a different URI per env) gets its own remote-set instance instead of reusing (or being
// blocked by) whatever URI happened to be current when this module first loaded.
const googleJwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function resolveGoogleJwks(jwksUri: string) {
  let jwks = googleJwksByUri.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri));
    googleJwksByUri.set(jwksUri, jwks);
  }
  return jwks;
}
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const APPLICATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function equalSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeApplicationId(applicationId: string): string {
  if (!APPLICATION_ID.test(applicationId)) throw new GoogleOidcError('configuration');
  return applicationId;
}

function normalizeApplicationOrigin(applicationOrigin: string): string {
  let url: URL;
  try {
    url = new URL(applicationOrigin);
  } catch {
    throw new GoogleOidcError('configuration');
  }

  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new GoogleOidcError('configuration');
  }

  return url.origin;
}

function normalizeReturnTo(returnTo: string | undefined, applicationOrigin: string): string {
  if (!returnTo) return '/';
  if (CONTROL_CHARACTERS.test(returnTo) || returnTo.includes('\\')) throw new GoogleOidcError('invalid_request');

  let destination: URL;
  try {
    destination = new URL(returnTo, `${applicationOrigin}/`);
  } catch {
    throw new GoogleOidcError('invalid_request');
  }

  if (destination.origin !== applicationOrigin) throw new GoogleOidcError('invalid_request');
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GoogleOidcError('token_exchange_failed');
  return value as Record<string, unknown>;
}

export async function createGoogleAuthorizationRequest({
  applicationId,
  applicationOrigin,
  store,
  returnTo,
  purpose = 'authentication',
  authenticatedUserId = null,
  config = loadGoogleOidcConfig(),
  nowMs = Date.now(),
  ttlSeconds = GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS,
}: {
  applicationId: string;
  applicationOrigin: string;
  store: GoogleOidcTransactionStore;
  returnTo?: string;
  purpose?: GoogleOidcTransactionPurpose;
  authenticatedUserId?: string | null;
  config?: GoogleOidcConfig;
  nowMs?: number;
  ttlSeconds?: number;
}): Promise<GoogleAuthorizationRequest> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS) {
    throw new GoogleOidcError('configuration');
  }
  if (purpose === 'external_identity_link' && !authenticatedUserId) throw new GoogleOidcError('configuration');
  if (purpose === 'authentication' && authenticatedUserId) throw new GoogleOidcError('configuration');

  const trustedApplicationId = normalizeApplicationId(applicationId);
  const trustedApplicationOrigin = normalizeApplicationOrigin(applicationOrigin);
  const state = randomBase64Url(32);
  const nonce = randomBase64Url(32);
  const codeVerifier = randomBase64Url(48);
  const expiresAtMs = nowMs + ttlSeconds * 1000;

  await store.create({
    provider: 'google',
    applicationId: trustedApplicationId,
    applicationOrigin: trustedApplicationOrigin,
    state,
    nonce,
    codeVerifier,
    redirectUri: config.redirectUri,
    returnTo: normalizeReturnTo(returnTo, trustedApplicationOrigin),
    purpose,
    authenticatedUserId,
    createdAtMs: nowMs,
    expiresAtMs,
  });

  const provider = resolveGoogleOidcProvider();
  const authorizationUrl = new URL(provider.authorizationEndpoint);
  authorizationUrl.searchParams.set('client_id', config.clientId);
  authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizationUrl.searchParams.set('response_type', GOOGLE_OIDC_PROVIDER.responseType);
  authorizationUrl.searchParams.set('response_mode', GOOGLE_OIDC_PROVIDER.responseMode);
  authorizationUrl.searchParams.set('scope', GOOGLE_OIDC_PROVIDER.scopes.join(' '));
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('nonce', nonce);
  authorizationUrl.searchParams.set('code_challenge', pkceChallenge(codeVerifier));
  authorizationUrl.searchParams.set('code_challenge_method', GOOGLE_OIDC_PROVIDER.codeChallengeMethod);

  return { authorizationUrl: authorizationUrl.toString(), expiresAtMs };
}

export async function completeGoogleOidcCallback({
  applicationId,
  applicationOrigin,
  code,
  state,
  providerError,
  store,
  config = loadGoogleOidcConfig(),
  fetchImpl = fetch,
  nowMs = Date.now(),
}: {
  applicationId: string;
  applicationOrigin: string;
  code?: string | null;
  state?: string | null;
  providerError?: string | null;
  store: GoogleOidcTransactionStore;
  config?: GoogleOidcConfig;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}): Promise<GoogleOidcIdentity> {
  if (!state) throw new GoogleOidcError('invalid_request');

  const trustedApplicationId = normalizeApplicationId(applicationId);
  const trustedApplicationOrigin = normalizeApplicationOrigin(applicationOrigin);
  const transaction = await store.consume(state);

  if (!transaction || transaction.provider !== 'google' || !equalSecret(transaction.state, state)) {
    throw new GoogleOidcError('invalid_transaction');
  }
  if (transaction.expiresAtMs <= nowMs) throw new GoogleOidcError('expired_transaction');
  if (
    transaction.applicationId !== trustedApplicationId ||
    transaction.applicationOrigin !== trustedApplicationOrigin ||
    transaction.redirectUri !== config.redirectUri
  ) {
    throw new GoogleOidcError('invalid_transaction');
  }
  if (transaction.purpose === 'external_identity_link' && !transaction.authenticatedUserId) {
    throw new GoogleOidcError('invalid_transaction');
  }
  if (transaction.purpose === 'authentication' && transaction.authenticatedUserId) {
    throw new GoogleOidcError('invalid_transaction');
  }
  if (providerError) throw new GoogleOidcError('provider_error');
  if (!code) throw new GoogleOidcError('invalid_request');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code_verifier: transaction.codeVerifier,
  });

  const provider = resolveGoogleOidcProvider();
  let response: Response;
  try {
    response = await fetchImpl(provider.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'error',
    });
  } catch {
    throw new GoogleOidcError('token_exchange_failed');
  }
  if (!response.ok) throw new GoogleOidcError('token_exchange_failed');

  let tokenResponse: Record<string, unknown>;
  try {
    tokenResponse = objectValue(await response.json());
  } catch (error) {
    if (error instanceof GoogleOidcError) throw error;
    throw new GoogleOidcError('token_exchange_failed');
  }

  const idToken = tokenResponse.id_token;
  if (typeof idToken !== 'string' || !idToken) throw new GoogleOidcError('token_exchange_failed');

  try {
    const { payload, protectedHeader } = await jwtVerify(idToken, resolveGoogleJwks(provider.jwksUri), {
      issuer: provider.issuer,
      audience: config.clientId,
      algorithms: [...GOOGLE_OIDC_PROVIDER.idTokenAlgorithms],
      clockTolerance: 5,
      maxTokenAge: '10m',
    });

    if (protectedHeader.alg !== 'RS256') throw new GoogleOidcError('invalid_id_token');
    if (typeof payload.nonce !== 'string' || !equalSecret(payload.nonce, transaction.nonce)) {
      throw new GoogleOidcError('invalid_id_token');
    }
    if (typeof payload.sub !== 'string' || !payload.sub) throw new GoogleOidcError('invalid_id_token');

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (audiences.length > 1 && payload.azp !== config.clientId) throw new GoogleOidcError('invalid_id_token');

    return {
      issuer: provider.issuer,
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : null,
      picture: typeof payload.picture === 'string' ? payload.picture : null,
      returnTo: transaction.returnTo,
      oauthTransactionPurpose: transaction.purpose,
      oauthAuthenticatedUserId: transaction.authenticatedUserId,
    };
  } catch (error) {
    if (error instanceof GoogleOidcError) throw error;
    throw new GoogleOidcError('invalid_id_token');
  }
}
