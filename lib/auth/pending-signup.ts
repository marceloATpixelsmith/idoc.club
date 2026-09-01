import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { requestCookies } from '@/lib/auth/request-cookies';
import { authSecretForServer } from '@/lib/runtime/configuration';

// Tracks an anonymous, in-progress signup (email submitted, awaiting OTP verification, then a
// password) without creating a `users` row until the password step completes — so an abandoned
// signup never leaves an orphaned, passwordless account behind. Deliberately separate from the
// real session cookie/signing surface in lib/auth/session.ts.
const COOKIE_NAME = 'idoc_pending_signup';
const LIFETIME_MS = 15 * 60 * 1000;
const signingKey = () => new TextEncoder().encode(authSecretForServer());

type PendingSignup = { email: string; verified: boolean };

async function setPendingSignupCookie(data: PendingSignup) {
  const token = await new SignJWT(data)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(signingKey());
  (await requestCookies()).set(COOKIE_NAME, token, {
    expires: new Date(Date.now() + LIFETIME_MS), httpOnly: true, sameSite: 'lax', secure: true,
  });
}

export async function startPendingSignup(email: string) {
  await setPendingSignupCookie({ email, verified: false });
}

export async function markPendingSignupVerified(email: string) {
  await setPendingSignupCookie({ email, verified: true });
}

export async function getPendingSignup(): Promise<PendingSignup | null> {
  const token = (await requestCookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || typeof payload.verified !== 'boolean') return null;
    return { email: payload.email, verified: payload.verified };
  } catch {
    return null;
  }
}

export async function clearPendingSignup() {
  (await requestCookies()).delete(COOKIE_NAME);
}
