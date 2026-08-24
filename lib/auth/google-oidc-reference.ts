import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export type GoogleOidcConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleOidcTransaction = {
  provider: 'google';
  applicationId: string;
  applicationOrigin: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
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
  redirectUri: 'GOOGLE_OAUTH_REDIRECT_URI',
} as const;

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

export function loadGoogleOidcConfig(env: NodeJS.ProcessEnv = process.env): GoogleOidcConfig {
  return {
    clientId: required(env, GOOGLE_OAUTH_ENV.clientId),
    clientSecret: required(env, GOOGLE_OAUTH_ENV.clientSecret),
    redirectUri: validRedirectUri(required(env, GOOGLE_OAUTH_ENV.redirectUri)),
  };
}

const googleJwks = createRemoteJWKSet(new URL(GOOGLE_OIDC_PROVIDER.jwksUri));
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
  config = loadGoogleOidcConfig(),
  nowMs = Date.now(),
  ttlSeconds = GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS,
}: {
  applicationId: string;
  applicationOrigin: string;
  store: GoogleOidcTransactionStore;
  returnTo?: string;
  config?: GoogleOidcConfig;
  nowMs?: number;
  ttlSeconds?: number;
}): Promise<GoogleAuthorizationRequest> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > GOOGLE_OAUTH_TRANSACTION_TTL_SECONDS) {
    throw new GoogleOidcError('configuration');
  }

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
    createdAtMs: nowMs,
    expiresAtMs,
  });

  const authorizationUrl = new URL(GOOGLE_OIDC_PROVIDER.authorizationEndpoint);
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

  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_OIDC_PROVIDER.tokenEndpoint, {
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
    const { payload, protectedHeader } = await jwtVerify(idToken, googleJwks, {
      issuer: GOOGLE_OIDC_PROVIDER.issuer,
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
      issuer: GOOGLE_OIDC_PROVIDER.issuer,
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : null,
      picture: typeof payload.picture === 'string' ? payload.picture : null,
      returnTo: transaction.returnTo,
    };
  } catch (error) {
    if (error instanceof GoogleOidcError) throw error;
    throw new GoogleOidcError('invalid_id_token');
  }
}
