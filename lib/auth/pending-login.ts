import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { requestCookies } from '@/lib/auth/request-cookies';
import { authSecretForServer } from '@/lib/runtime/configuration';
import { generatePendingCsrfNonce } from '@/lib/security/csrf';

const COOKIE_NAME = 'idoc_pending_login';
const LIFETIME_MS = 15 * 60 * 1000;
const signingKey = () => new TextEncoder().encode(authSecretForServer());

// csrfNonce: see lib/security/csrf.ts's generatePendingCsrfNonce doc comment -- minted once by
// startPendingLogin (the flow's only entry point) and carried forward unchanged into the
// 'login-otp' stage by requireLoginOtp, so the general CSRF cookie's real, confirmed
// client-side-navigation staleness risk never applies to this flow's own forms.
export type PendingLogin =
  | { csrfNonce: string; email: string; stage: 'password' }
  | { allowRemember: boolean; csrfNonce: string; email: string; sessionVersion: number; stage: 'login-otp'; userId: number };

async function setPendingLoginCookie(data: PendingLogin) {
  const token = await new SignJWT(data).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setExpirationTime('15m').sign(signingKey());
  (await requestCookies()).set(COOKIE_NAME, token, {
    expires: new Date(Date.now() + LIFETIME_MS), httpOnly: true, sameSite: 'lax', secure: true,
  });
}

export async function startPendingLogin(email: string) {
  await setPendingLoginCookie({ csrfNonce: generatePendingCsrfNonce(), email, stage: 'password' });
}

export async function requireLoginOtp(email: string, userId: number, sessionVersion: number, allowRemember: boolean, csrfNonce: string) {
  await setPendingLoginCookie({ allowRemember, csrfNonce, email, sessionVersion, stage: 'login-otp', userId });
}

export async function getPendingLogin(): Promise<PendingLogin | null> {
  const token = (await requestCookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || !['password', 'login-otp'].includes(String(payload.stage)) ||
      typeof payload.csrfNonce !== 'string' || payload.csrfNonce.length < 16) return null;
    if (payload.stage === 'password') return { csrfNonce: payload.csrfNonce, email: payload.email, stage: 'password' };
    if (typeof payload.userId !== 'number' || typeof payload.sessionVersion !== 'number' || typeof payload.allowRemember !== 'boolean') return null;
    return { allowRemember: payload.allowRemember, csrfNonce: payload.csrfNonce, email: payload.email, sessionVersion: payload.sessionVersion, stage: 'login-otp', userId: payload.userId };
  } catch { return null; }
}

export async function clearPendingLogin() { (await requestCookies()).delete(COOKIE_NAME); }
