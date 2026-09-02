import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { requestCookies, testRequestEnvironment } from '@/lib/auth/request-cookies';
import { csrfCookieName, csrfCookieOptions, signCsrfToken, verifyCsrfToken } from '@/lib/security/csrf-tokens';

// Deliberately does not import from lib/auth/session.ts: session.ts calls issueCsrfToken/
// clearCsrfToken below to rotate the token at login/logout, so importing getSession() here would
// create a module cycle. Callers (lib/auth/middleware.ts) supply the current session id explicitly.

const FIELD_NAME = 'csrf_token';

function requestEnvironment() {
  return testRequestEnvironment() ?? process.env;
}

export class CsrfError extends Error {
  constructor() {
    super('Your session security check failed. Refresh the page and try again.');
    this.name = 'CsrfError';
  }
}

/** Mints and sets a fresh CSRF cookie bound to the given session id (or `null` while anonymous),
 * returning the raw token value. Called from setSession()/clearSession() to rotate the token at
 * authentication boundaries, and by middleware.ts (via the pure csrf-tokens.ts functions directly,
 * since middleware has no next/headers) to mint one lazily for a visitor who doesn't have one yet. */
export async function issueCsrfToken(sessionRef: string | null): Promise<string> {
  const token = await signCsrfToken(sessionRef);
  const environment = requestEnvironment();
  (await requestCookies()).set(csrfCookieName(environment), token, csrfCookieOptions(environment));
  return token;
}

export async function clearCsrfToken(): Promise<void> {
  (await requestCookies()).delete(csrfCookieName(requestEnvironment()));
}

/** Reads the current, unvalidated raw cookie value -- used by <CsrfField/> and any Server Component
 * that needs to render the token into a hidden form field or client-side Context provider value. */
export async function currentCsrfToken(): Promise<string | null> {
  return (await requestCookies()).get(csrfCookieName(requestEnvironment()))?.value ?? null;
}

function timingSafeStringsEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/** The actual AUTH-CSRF-003 validation: the candidate value (from a hidden form field, or an
 * explicit argument for a JS-invoked, non-<form> Server Action) must exactly match the current
 * cookie (an attacker's forged cross-site request cannot read or set that cookie's value), the
 * cookie itself must verify as a real, unexpired, correctly-purposed signed token, and its bound
 * session reference must match `expectedSessionRef` (the caller's actual current session id, or
 * `null` while anonymous) -- a token minted anonymously, or under a different session, is not valid
 * evidence for this one. */
async function csrfEvidenceIsValid(candidate: string | null | undefined, expectedSessionRef: string | null): Promise<boolean> {
  const cookieToken = await currentCsrfToken();
  if (!cookieToken || !candidate) return false;
  if (!timingSafeStringsEqual(cookieToken, candidate)) return false;
  const payload = await verifyCsrfToken(cookieToken);
  if (!payload) return false;
  if (payload.sessionRef !== expectedSessionRef) return false;
  return true;
}

/** Throws CsrfError unless `formData` carries a valid csrf_token field matching the current,
 * session-bound cookie. The standard entry point for form-submitted Server Actions. Pass the
 * caller's current session id (from getSession()), or null while anonymous. */
export async function requireCsrfToken(formData: FormData, expectedSessionRef: string | null): Promise<void> {
  const value = formData.get(FIELD_NAME);
  if (!(await csrfEvidenceIsValid(typeof value === 'string' ? value : null, expectedSessionRef))) throw new CsrfError();
}

/** Same validation as requireCsrfToken, for a JS-invoked Server Action that has no FormData at all
 * (e.g. signOut()) and instead receives the token as an explicit argument read client-side from the
 * (deliberately non-httpOnly) CSRF cookie. */
export async function requireCsrfTokenValue(token: string | null | undefined, expectedSessionRef: string | null): Promise<void> {
  if (!(await csrfEvidenceIsValid(token, expectedSessionRef))) throw new CsrfError();
}

export const CSRF_FIELD_NAME = FIELD_NAME;
