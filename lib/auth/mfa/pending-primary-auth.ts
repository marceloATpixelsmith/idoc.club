import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { requestCookies } from '@/lib/auth/request-cookies';
import { mfaConfiguration } from '@/lib/runtime/configuration';
import { generatePendingCsrfNonce } from '@/lib/security/csrf';

export { generatePendingCsrfNonce };

const COOKIE_NAME = 'idoc_pending_primary_mfa';
const TTL_SECONDS = 10 * 60;

export type PendingPrimaryAuth = {
  applicationId: 'idoc.club';
  // A real, reproducible production report: the general site-wide CSRF cookie is sourced from a
  // React Context living in the root layout, which Next.js can reuse (not re-render) across the
  // client-side navigation that follows every redirect() a Server Action in this file's flow makes
  // -- so the token a later stage's form submits can legitimately drift from the current cookie
  // through no fault of the member's, confirmed via production logs (reason: value_mismatch,
  // expectedSessionPresent: false, i.e. not a session/multi-tab issue at all). csrfNonce is minted
  // once when a flow begins (beginPrimaryMfa, beginAuthenticatorReplacement) and carried forward
  // unchanged by every later stage transition in the same flow (every other setPendingPrimaryAuth
  // call spreads the prior pending value). It is rendered directly as this page's own hidden
  // csrf_token field (app/(login)/mfa/page.tsx / mfa-form.tsx), a plain per-request server-rendered
  // value with no Context/layout-reuse staleness risk, and accepted as an alternative to the
  // general CSRF cookie by the actions in app/(login)/mfa/actions.ts that drive this flow.
  csrfNonce: string;
  factorId: string;
  hasWebAuthn: boolean;
  method: 'google' | 'password';
  sessionVersion: number;
  stage: 'challenge' | 'enrollment' | 'recovery-entry' | 'replacement' | 'recovery-ack';
  subjectId: number;
  transactionId: string;
  returnTo: string;
};

function options(expires: Date) {
  return { expires, httpOnly: true, path: '/', sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' };
}

export async function setPendingPrimaryAuth(value: PendingPrimaryAuth) {
  const token = await new SignJWT(value).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${TTL_SECONDS}s`)
    .sign(mfaConfiguration().continuationKey);
  (await requestCookies()).set(COOKIE_NAME, token, options(new Date(Date.now() + TTL_SECONDS * 1000)));
}

export async function getPendingPrimaryAuth(): Promise<PendingPrimaryAuth | null> {
  const token = (await requestCookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, mfaConfiguration().continuationKey, { algorithms: ['HS256'] });
    if (payload.applicationId !== 'idoc.club' || !Number.isSafeInteger(payload.subjectId) ||
      !Number.isSafeInteger(payload.sessionVersion) || typeof payload.factorId !== 'string' ||
      typeof payload.hasWebAuthn !== 'boolean' || typeof payload.csrfNonce !== 'string' || payload.csrfNonce.length < 16 ||
      typeof payload.transactionId !== 'string' || !['google', 'password'].includes(String(payload.method)) ||
      !['challenge', 'enrollment', 'recovery-entry', 'replacement', 'recovery-ack'].includes(String(payload.stage)) || typeof payload.returnTo !== 'string') return null;
    return payload as unknown as PendingPrimaryAuth;
  } catch { return null; }
}

export async function clearPendingPrimaryAuth() { (await requestCookies()).delete(COOKIE_NAME); }
