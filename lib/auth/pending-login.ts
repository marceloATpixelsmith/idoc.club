import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { authSecretForServer } from '@/lib/runtime/configuration';

// Tracks an anonymous, in-progress login (email submitted, branching to either a plain password
// step or, for a legacy pre-launch member, an OTP-verified activation step) without ever holding a
// password in the cookie itself. Deliberately separate from the real session cookie/signing surface
// in lib/auth/session.ts and from the signup flow's own pending cookie.
const COOKIE_NAME = 'idoc_pending_login';
const LIFETIME_MS = 15 * 60 * 1000;
const signingKey = () => new TextEncoder().encode(authSecretForServer());

type PendingLogin = { email: string; legacy: boolean; verified: boolean };

async function setPendingLoginCookie(data: PendingLogin) {
  const token = await new SignJWT(data)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(signingKey());
  (await cookies()).set(COOKIE_NAME, token, {
    expires: new Date(Date.now() + LIFETIME_MS), httpOnly: true, sameSite: 'lax', secure: true,
  });
}

export async function startPendingLogin(email: string, legacy: boolean) {
  await setPendingLoginCookie({ email, legacy, verified: !legacy });
}

export async function markPendingLoginVerified(email: string) {
  await setPendingLoginCookie({ email, legacy: true, verified: true });
}

export async function getPendingLogin(): Promise<PendingLogin | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || typeof payload.legacy !== 'boolean' || typeof payload.verified !== 'boolean') return null;
    return { email: payload.email, legacy: payload.legacy, verified: payload.verified };
  } catch {
    return null;
  }
}

export async function clearPendingLogin() {
  (await cookies()).delete(COOKIE_NAME);
}
