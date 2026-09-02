import { randomUUID } from 'node:crypto';
import { requestCookies, testRequestEnvironment } from '@/lib/auth/request-cookies';
import { NewUser } from '@/lib/db/schema';
import {
  readActiveSession,
  registerSession,
  revokeSession,
  touchSession,
} from '@/lib/auth/session-registry';
import { clearCsrfToken, issueCsrfToken } from '@/lib/security/csrf';
import 'server-only';

export { comparePasswords, hashPassword, passwordHashNeedsUpgrade } from '@/lib/auth/password-hash';
export {
  DEVELOPMENT_SESSION_COOKIE_NAME,
  LEGACY_SESSION_COOKIE_NAME,
  PRODUCTION_SESSION_COOKIE_NAME,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
  assertSessionFresh,
  expiredSessionCookieOptions,
  refreshSessionActivity,
  sessionCookieName,
  sessionCookieOptions,
  signToken,
  verifyToken,
} from '@/lib/auth/session-tokens';
export type { SessionData } from '@/lib/auth/session-tokens';

import {
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_ABSOLUTE_SECONDS,
  SessionData,
  expiredSessionCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
  signToken,
  verifyToken,
} from '@/lib/auth/session-tokens';

function requestEnvironment() {
  return testRequestEnvironment() ?? process.env;
}

async function registeredSessionIsValid(session: SessionData, now = new Date()) {
  // Database failures intentionally propagate. Only an absent/mismatched registry record is an
  // authentication-validation failure that should be treated as an invalid session.
  const record = await readActiveSession(session.sessionId, session.user.id);
  if (!record) return false;
  if (record.sessionVersion !== session.user.sessionVersion) return false;
  if (new Date(record.authenticatedAt).getTime() !== new Date(session.authenticatedAt).getTime()) return false;
  if (new Date(record.absoluteExpiresAt).getTime() !== new Date(session.absoluteExpiresAt).getTime()) return false;
  await touchSession(session.sessionId, session.user.id, now);
  return true;
}

export async function getSession() {
  const cookieStore = await requestCookies();
  const canonicalValue = cookieStore.get(sessionCookieName(requestEnvironment()))?.value;
  if (!canonicalValue) return null;

  let session: SessionData;
  try {
    session = await verifyToken(canonicalValue);
  } catch {
    return null;
  }
  // A signed JWT alone is never sufficient authentication authority: every canonical session must
  // also carry an active, matching persisted registry row (see registeredSessionIsValid above). The
  // legacy pre-retrofit cookie is never accepted here at all -- only ever cleared defensively, in
  // setSession/clearSession below and in middleware.ts.
  return (await registeredSessionIsValid(session)) ? session : null;
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

  await registerSession({
    sessionId: session.sessionId,
    userId: session.user.id,
    sessionVersion: session.user.sessionVersion,
    authenticatedAt: new Date(session.authenticatedAt),
    lastActivityAt: new Date(session.lastActivityAt),
    absoluteExpiresAt: new Date(session.absoluteExpiresAt),
  });

  const environment = requestEnvironment();
  const cookieStore = await requestCookies();
  cookieStore.set(sessionCookieName(environment), await signToken(session), sessionCookieOptions(session.absoluteExpiresAt, environment));
  cookieStore.delete(LEGACY_SESSION_COOKIE_NAME);
  // AUTH-CSRF-003: rotate CSRF evidence to the newly-established session. A token minted before
  // login (anonymous, sessionRef: null) or under a prior session is not valid evidence afterward.
  await issueCsrfToken(session.sessionId);
}

export async function clearSession() {
  const environment = requestEnvironment();
  const cookieStore = await requestCookies();
  const canonicalValue = cookieStore.get(sessionCookieName(environment))?.value;
  if (canonicalValue) {
    let session: SessionData | null = null;
    try {
      session = await verifyToken(canonicalValue);
    } catch {
      // Invalid client evidence is cleared below, but never trusted for registry mutation.
    }
    if (session) {
      // Deliberately not caught: a registry failure must fail sign-out before the browser cookie is
      // cleared, otherwise a copied bearer token could remain valid after a reported successful logout.
      await revokeSession(session.sessionId, session.user.id, 'user-signout');
    }
  }
  cookieStore.set(sessionCookieName(environment), '', expiredSessionCookieOptions(environment));
  cookieStore.delete(LEGACY_SESSION_COOKIE_NAME);
  cookieStore.delete('idoc_pending_step_up');
  cookieStore.delete('idoc_fresh_step_up');
  // AUTH-CSRF-003: a token bound to the now-revoked session must not remain valid evidence. The
  // next page load's middleware mints a fresh, anonymously-bound one lazily.
  await clearCsrfToken();
}
