import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { authSecretForServer } from '@/lib/runtime/configuration';

// Tracks an anonymous, in-progress password reset (email submitted, awaiting OTP verification,
// then a new password). Deliberately separate from the real session cookie and from the
// signup/login flows' own pending cookies.
const COOKIE_NAME = 'idoc_pending_password_reset';
const LIFETIME_MS = 15 * 60 * 1000;
const signingKey = () => new TextEncoder().encode(authSecretForServer());

type PendingPasswordReset = { email: string; verified: boolean };

async function setPendingPasswordResetCookie(data: PendingPasswordReset) {
  const token = await new SignJWT(data)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(signingKey());
  (await cookies()).set(COOKIE_NAME, token, {
    expires: new Date(Date.now() + LIFETIME_MS), httpOnly: true, sameSite: 'lax', secure: true,
  });
}

export async function startPendingPasswordReset(email: string) {
  await setPendingPasswordResetCookie({ email, verified: false });
}

export async function markPendingPasswordResetVerified(email: string) {
  await setPendingPasswordResetCookie({ email, verified: true });
}

export async function getPendingPasswordReset(): Promise<PendingPasswordReset | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || typeof payload.verified !== 'boolean') return null;
    return { email: payload.email, verified: payload.verified };
  } catch {
    return null;
  }
}

export async function clearPendingPasswordReset() {
  (await cookies()).delete(COOKIE_NAME);
}
