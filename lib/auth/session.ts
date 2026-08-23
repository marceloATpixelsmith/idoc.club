import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NewUser } from '@/lib/db/schema';
import { authSecretForServer } from '@/lib/runtime/configuration';
import 'server-only';

export { comparePasswords, hashPassword, passwordHashNeedsUpgrade } from '@/lib/auth/password-hash';

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

export function sessionCookieName() {
  return process.env.NODE_ENV === 'production'
    ? PRODUCTION_SESSION_COOKIE_NAME
    : DEVELOPMENT_SESSION_COOKIE_NAME;
}

export function sessionCookieOptions(absoluteExpiresAt: string) {
  return {
    expires: new Date(absoluteExpiresAt),
    httpOnly: true,
    path: '/' as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
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

  // One-way compatibility bridge for the pre-canonical one-day JWT. The old token is never
  // refreshed in its old shape: middleware upgrades it to the canonical cookie on the next GET.
  if (typeof payload.iat === 'number') {
    const authenticatedAt = isoFromEpochSeconds(payload.iat);
    return {
      version: 2,
      sessionId: randomUUID(),
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

export async function getSession() {
  const cookieStore = await cookies();
  const value = cookieStore.get(sessionCookieName())?.value
    ?? cookieStore.get(LEGACY_SESSION_COOKIE_NAME)?.value;
  if (!value) return null;
  try {
    return await verifyToken(value);
  } catch {
    return null;
  }
}

export async function setSession(user: NewUser) {
  const now = new Date();
  const session: SessionData = {
    version: 2,
    sessionId: randomUUID(),
    user: { id: user.id!, sessionVersion: user.sessionVersion ?? 0 },
    authenticatedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_SECONDS * 1000).toISOString(),
  };
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), await signToken(session), sessionCookieOptions(session.absoluteExpiresAt));
  cookieStore.delete(LEGACY_SESSION_COOKIE_NAME);
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName());
  cookieStore.delete(LEGACY_SESSION_COOKIE_NAME);
}
