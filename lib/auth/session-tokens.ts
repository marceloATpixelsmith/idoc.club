import { SignJWT, jwtVerify } from 'jose';
// Keep this import Node-resolvable as well as bundler-resolvable, matching lib/auth/turnstile.ts:
// unit tests execute this module directly under Node's ESM resolver without the Next.js @/* alias.
import { authSecretForServer } from '../runtime/configuration.ts';
import 'server-only';

/**
 * Pure session-token logic: signing, verification, freshness, and cookie-attribute derivation.
 * Deliberately has no Next.js request-scoped dependency (no `next/headers`) so it can be exercised
 * directly by unit tests, including exact idle/absolute-timeout boundary cases. `lib/auth/session.ts`
 * re-exports everything here and adds the request-scoped cookie/registry orchestration on top.
 */

export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;
export const PRODUCTION_SESSION_COOKIE_NAME = '__Host-idoc-session';
export const DEVELOPMENT_SESSION_COOKIE_NAME = 'idoc-session';
export const LEGACY_SESSION_COOKIE_NAME = 'session';

const signingKey = () => new TextEncoder().encode(authSecretForServer());

export type SessionData = {
  version: 2;
  sessionId: string;
  user: { id: number; sessionVersion: number };
  authenticatedAt: string;
  lastActivityAt: string;
  absoluteExpiresAt: string;
};

// Environment is injectable, matching lib/runtime/configuration.ts's established pattern, so
// production-mode cookie attributes can be asserted directly without mutating process.env in tests.
type Environment = Partial<Record<string, string | undefined>>;

export function sessionCookieName(environment: Environment = process.env) {
  return environment.NODE_ENV === 'production'
    ? PRODUCTION_SESSION_COOKIE_NAME
    : DEVELOPMENT_SESSION_COOKIE_NAME;
}

function canonicalCookieSecurityAttributes(environment: Environment = process.env) {
  return {
    httpOnly: true,
    path: '/' as const,
    sameSite: 'lax' as const,
    secure: environment.NODE_ENV === 'production',
  };
}

export function sessionCookieOptions(absoluteExpiresAt: string, environment: Environment = process.env) {
  return {
    ...canonicalCookieSecurityAttributes(environment),
    expires: new Date(absoluteExpiresAt),
  };
}

export function expiredSessionCookieOptions(environment: Environment = process.env) {
  return {
    ...canonicalCookieSecurityAttributes(environment),
    expires: new Date(0),
    maxAge: 0,
  };
}

function isoFromEpochSeconds(value: number) {
  return new Date(value * 1000).toISOString();
}

function normalizeSessionPayload(payload: Record<string, unknown>): SessionData {
  const user = payload.user as { id?: unknown; sessionVersion?: unknown } | undefined;
  if (!user || typeof user.id !== 'number' || typeof user.sessionVersion !== 'number') {
    throw new Error('Invalid session identity payload.');
  }

  if (
    payload.version === 2 &&
    typeof payload.sessionId === 'string' &&
    typeof payload.authenticatedAt === 'string' &&
    typeof payload.lastActivityAt === 'string' &&
    typeof payload.absoluteExpiresAt === 'string'
  ) {
    return {
      version: 2,
      sessionId: payload.sessionId,
      user: { id: user.id, sessionVersion: user.sessionVersion },
      authenticatedAt: payload.authenticatedAt,
      lastActivityAt: payload.lastActivityAt,
      absoluteExpiresAt: payload.absoluteExpiresAt,
    };
  }

  // One-way compatibility input for the pre-canonical cookie. Legacy tokens never become
  // registry-backed canonical sessions; they age out under the 12-hour absolute cap or are
  // replaced by a fresh registered session on the next successful authentication.
  if (typeof payload.iat === 'number') {
    const authenticatedAt = isoFromEpochSeconds(payload.iat);
    return {
      version: 2,
      sessionId: `legacy-${payload.iat}-${user.id}`,
      user: { id: user.id, sessionVersion: user.sessionVersion },
      authenticatedAt,
      lastActivityAt: authenticatedAt,
      absoluteExpiresAt: new Date(payload.iat * 1000 + SESSION_ABSOLUTE_SECONDS * 1000).toISOString(),
    };
  }

  throw new Error('Unsupported session payload.');
}

export function assertSessionFresh(session: SessionData, now = new Date()) {
  const nowMs = now.getTime();
  const authenticatedAtMs = new Date(session.authenticatedAt).getTime();
  const lastActivityAtMs = new Date(session.lastActivityAt).getTime();
  const absoluteExpiresAtMs = new Date(session.absoluteExpiresAt).getTime();

  if (![authenticatedAtMs, lastActivityAtMs, absoluteExpiresAtMs].every(Number.isFinite)) {
    throw new Error('Invalid session timestamps.');
  }
  if (absoluteExpiresAtMs !== authenticatedAtMs + SESSION_ABSOLUTE_SECONDS * 1000) {
    throw new Error('Invalid absolute session lifetime.');
  }
  if (nowMs >= absoluteExpiresAtMs) throw new Error('Session absolute lifetime expired.');
  if (nowMs - lastActivityAtMs >= SESSION_IDLE_SECONDS * 1000) throw new Error('Session idle lifetime expired.');
  if (lastActivityAtMs < authenticatedAtMs || lastActivityAtMs > nowMs + 60_000) {
    throw new Error('Invalid session activity timestamp.');
  }
}

export function refreshSessionActivity(session: SessionData, now = new Date()): SessionData {
  assertSessionFresh(session, now);
  return { ...session, lastActivityAt: now.toISOString() };
}

export async function signToken(payload: SessionData) {
  assertSessionFresh(payload);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(new Date(payload.absoluteExpiresAt).getTime() / 1000))
    .sign(signingKey());
}

export async function verifyToken(input: string, now = new Date()) {
  const { payload } = await jwtVerify(input, signingKey(), { algorithms: ['HS256'] });
  const session = normalizeSessionPayload(payload as Record<string, unknown>);
  assertSessionFresh(session, now);
  return session;
}
