import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { authSecretForServer } from '@/lib/runtime/configuration';

const COOKIE_NAME = 'idoc_pending_login';
const LIFETIME_MS = 15 * 60 * 1000;
const signingKey = () => new TextEncoder().encode(authSecretForServer());

export type PendingLogin =
  | { email: string; stage: 'password' }
  | { allowRemember: boolean; email: string; sessionVersion: number; stage: 'login-otp'; userId: number };

async function setPendingLoginCookie(data: PendingLogin) {
  const token = await new SignJWT(data).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setExpirationTime('15m').sign(signingKey());
  (await cookies()).set(COOKIE_NAME, token, {
    expires: new Date(Date.now() + LIFETIME_MS), httpOnly: true, sameSite: 'lax', secure: true,
  });
}

export async function startPendingLogin(email: string) {
  await setPendingLoginCookie({ email, stage: 'password' });
}

export async function requireLoginOtp(email: string, userId: number, sessionVersion: number, allowRemember: boolean) {
  await setPendingLoginCookie({ allowRemember, email, sessionVersion, stage: 'login-otp', userId });
}

export async function getPendingLogin(): Promise<PendingLogin | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || !['password', 'login-otp'].includes(String(payload.stage))) return null;
    if (payload.stage === 'password') return { email: payload.email, stage: 'password' };
    if (typeof payload.userId !== 'number' || typeof payload.sessionVersion !== 'number' || typeof payload.allowRemember !== 'boolean') return null;
    return { allowRemember: payload.allowRemember, email: payload.email, sessionVersion: payload.sessionVersion, stage: 'login-otp', userId: payload.userId };
  } catch { return null; }
}

export async function clearPendingLogin() { (await cookies()).delete(COOKIE_NAME); }
