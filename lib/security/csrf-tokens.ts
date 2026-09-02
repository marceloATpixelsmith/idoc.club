import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
// Keep this import Node-resolvable as well as bundler-resolvable, matching lib/auth/session-tokens.ts:
// unit tests execute this module directly under Node's ESM resolver without the Next.js @/* alias.
import { authSecretRingForServer } from '../runtime/configuration.ts';
import 'server-only';

/**
 * Pure CSRF-token logic: signing, verification, and cookie-attribute derivation. Deliberately has
 * no Next.js request-scoped dependency (no `next/headers`) so it can be exercised directly by unit
 * tests and by middleware.ts (edge/Node middleware cannot use `next/headers`). lib/security/csrf.ts
 * adds the request-scoped cookie orchestration on top, matching lib/auth/session.ts's split from
 * lib/auth/session-tokens.ts.
 *
 * AUTH-CSRF-003 ("Secure CSRF evidence"): tokens must be unpredictable/cryptographically
 * authenticated, bound, server-validated, and expired/rotated -- "hidden fields alone provide no
 * protection." This implements a server-bound, signed double-submit-cookie token: a CSPRNG nonce
 * inside a signed, expiring JWT, issued as BOTH a cookie and (via a hidden form field, or an
 * explicit argument for JS-invoked Server Actions) the value a mutation must also present. The
 * cookie is deliberately not httpOnly -- the security property of a double-submit token is that a
 * cross-origin attacker page can never read *our* origin's cookie (browser same-origin policy), not
 * that our own same-origin JS can't; same-origin JS reading it to attach to a non-<form> Server
 * Action call (e.g. signOut()) is the standard, intended use of this pattern.
 */

export const CSRF_TOKEN_TTL_SECONDS = 4 * 60 * 60;
export const PRODUCTION_CSRF_COOKIE_NAME = '__Host-idoc-csrf';
export const DEVELOPMENT_CSRF_COOKIE_NAME = 'idoc-csrf';

type Environment = Partial<Record<string, string | undefined>>;

const signingKey = () => new TextEncoder().encode(authSecretRingForServer()[0]);
const verificationKeys = () => authSecretRingForServer().map((key) => new TextEncoder().encode(key));

export function csrfCookieName(environment: Environment = process.env) {
  return environment.NODE_ENV === 'production' ? PRODUCTION_CSRF_COOKIE_NAME : DEVELOPMENT_CSRF_COOKIE_NAME;
}

export function csrfCookieOptions(environment: Environment = process.env) {
  return {
    // Deliberately NOT httpOnly -- see the module doc comment above.
    httpOnly: false,
    maxAge: CSRF_TOKEN_TTL_SECONDS,
    path: '/' as const,
    sameSite: 'lax' as const,
    secure: environment.NODE_ENV === 'production',
  };
}

export type CsrfTokenPayload = { nonce: string; purpose: 'csrf'; sessionRef: string | null };

/** `sessionRef` binds the token to the current session id (or null while anonymous), so a token
 * minted before login, or under a different session entirely, is never valid evidence afterward --
 * this is the "reject...cross-session submissions" property, not merely signature validity. */
export async function signCsrfToken(sessionRef: string | null): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');
  return new SignJWT({ nonce, purpose: 'csrf', sessionRef } satisfies CsrfTokenPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${CSRF_TOKEN_TTL_SECONDS}s`)
    .sign(signingKey());
}

export async function verifyCsrfToken(token: string): Promise<CsrfTokenPayload | null> {
  for (const key of verificationKeys()) {
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
      if (
        payload.purpose !== 'csrf' ||
        typeof payload.nonce !== 'string' ||
        (payload.sessionRef !== null && typeof payload.sessionRef !== 'string')
      ) return null;
      return { nonce: payload.nonce, purpose: 'csrf', sessionRef: (payload.sessionRef as string | null) ?? null };
    } catch { /* try the next verification key in the rotation ring */ }
  }
  return null;
}
