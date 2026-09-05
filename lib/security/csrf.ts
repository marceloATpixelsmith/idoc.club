import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { requestCookies, testRequestEnvironment } from '@/lib/auth/request-cookies';
import { csrfCookieName, csrfCookieOptions, signCsrfToken, verifyCsrfToken } from '@/lib/security/csrf-tokens';
import { logWarn } from '@/lib/observability/logger';

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

type CsrfFailureReason = 'missing_cookie' | 'missing_candidate' | 'value_mismatch' | 'invalid_token' | 'session_ref_mismatch';

/** Real production reports of unexplained, reproducible CSRF rejections (a multi-step recovery
 * flow's final confirmation step, in particular) previously had no way to be diagnosed beyond
 * re-reading this file's logic and guessing -- a rejection was just a generic thrown error, with
 * no record anywhere of *which* of the several distinct failure conditions actually fired. This
 * never logs the cookie or candidate token values themselves (both are secrets), only the
 * category of failure and whether a session was expected/bound, which is enough to distinguish
 * "no evidence was ever submitted" from "the evidence didn't match" from "it matched a different
 * session than expected" (e.g. the shared cookie jar was rebound by an unrelated authenticated
 * request landing in the same browser mid-flow). */
async function evaluateCsrfFailure(
  candidate: string | null | undefined,
  expectedSessionRef: string | null,
): Promise<{ reason: CsrfFailureReason; tokenSessionPresent?: boolean } | null> {
  const cookieToken = await currentCsrfToken();
  if (!cookieToken) return { reason: 'missing_cookie' };
  if (!candidate) return { reason: 'missing_candidate' };
  if (!timingSafeStringsEqual(cookieToken, candidate)) return { reason: 'value_mismatch' };
  const payload = await verifyCsrfToken(cookieToken);
  if (!payload) return { reason: 'invalid_token' };
  if (payload.sessionRef !== expectedSessionRef) return { reason: 'session_ref_mismatch', tokenSessionPresent: payload.sessionRef !== null };
  return null;
}

/** The actual AUTH-CSRF-003 validation: the candidate value (from a hidden form field, or an
 * explicit argument for a JS-invoked, non-<form> Server Action) must exactly match the current
 * cookie (an attacker's forged cross-site request cannot read or set that cookie's value), the
 * cookie itself must verify as a real, unexpired, correctly-purposed signed token, and its bound
 * session reference must match `expectedSessionRef` (the caller's actual current session id, or
 * `null` while anonymous) -- a token minted anonymously, or under a different session, is not valid
 * evidence for this one.
 *
 * `subjectId` is an optional, already-resolved user id (a Codex review finding on the first
 * version of this logging: unconditionally attributing every failure as 'anonymous' is misleading
 * for an authenticated action, and breaks the taxonomy's own subject-attribution invariant) --
 * callers that already have a resolved identity at the point CSRF is checked (validatedActionWithUser's
 * DB-fetched user, or any bare call site's cheap JWT-only rawCanonicalUserId()) pass it through so a
 * rejected check on an authenticated action is logged against that account instead of anonymously. */
async function csrfEvidenceIsValid(
  candidate: string | null | undefined,
  expectedSessionRef: string | null,
  subjectId?: number | null,
): Promise<boolean> {
  const failure = await evaluateCsrfFailure(candidate, expectedSessionRef);
  if (!failure) return true;
  const tokenSessionMeta = failure.tokenSessionPresent !== undefined ? { tokenSessionPresent: failure.tokenSessionPresent } : {};
  if (subjectId != null) {
    await logWarn('csrf_validation_failed_authenticated', { reason: failure.reason, subjectId, ...tokenSessionMeta });
  } else {
    await logWarn('csrf_validation_failed', { expectedSessionPresent: expectedSessionRef !== null, reason: failure.reason, ...tokenSessionMeta });
  }
  return false;
}

/** Throws CsrfError unless `formData` carries a valid csrf_token field matching the current,
 * session-bound cookie. The standard entry point for form-submitted Server Actions. Pass the
 * caller's current session id (from getSession()), or null while anonymous; pass an already-resolved
 * user id too when one is cheaply available, so a rejection attributes to the real account. */
export async function requireCsrfToken(formData: FormData, expectedSessionRef: string | null, subjectId?: number | null): Promise<void> {
  const value = formData.get(FIELD_NAME);
  if (!(await csrfEvidenceIsValid(typeof value === 'string' ? value : null, expectedSessionRef, subjectId))) throw new CsrfError();
}

/** Same validation as requireCsrfToken, for a JS-invoked Server Action that has no FormData at all
 * (e.g. signOut()) and instead receives the token as an explicit argument read client-side from the
 * (deliberately non-httpOnly) CSRF cookie. */
export async function requireCsrfTokenValue(token: string | null | undefined, expectedSessionRef: string | null, subjectId?: number | null): Promise<void> {
  if (!(await csrfEvidenceIsValid(token, expectedSessionRef, subjectId))) throw new CsrfError();
}

/** For the small family of Server Actions driving lib/auth/mfa/pending-primary-auth.ts's multi-step
 * anonymous continuation flow (recovery-entry -> replacement -> recovery-ack, etc.): a real,
 * reproducible production report proved the general session-bound CSRF cookie can legitimately
 * drift from what an in-flight page's form submits, through no fault of the member's -- see that
 * file's PendingPrimaryAuth.csrfNonce doc comment for the full mechanism. Accepts the request when
 * EITHER the general CSRF cookie matches (unchanged fallback, still checked and still logged the
 * same way on failure) OR the submitted value exactly matches the flow's own per-flow nonce, which
 * is minted and read together with the rest of that signed, httpOnly cookie and can never drift
 * out from under its own form the way the general cookie can. `pendingNonce` is `null` when no such
 * flow is active (pendingAccount() already returned null), in which case this is identical to
 * requireCsrfToken. */
export async function requireCsrfTokenOrPendingNonce(
  formData: FormData,
  expectedSessionRef: string | null,
  subjectId: number | null | undefined,
  pendingNonce: string | null,
): Promise<void> {
  const value = formData.get(FIELD_NAME);
  const candidate = typeof value === 'string' ? value : null;
  if (pendingNonce && candidate && timingSafeStringsEqual(candidate, pendingNonce)) return;
  if (!(await csrfEvidenceIsValid(candidate, expectedSessionRef, subjectId))) throw new CsrfError();
}

export const CSRF_FIELD_NAME = FIELD_NAME;
