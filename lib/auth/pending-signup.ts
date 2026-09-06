import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { requestCookies } from '@/lib/auth/request-cookies';
import { authSecretForServer } from '@/lib/runtime/configuration';
import { generatePendingCsrfNonce } from '@/lib/security/csrf';
import { parseMemberClassification, type MemberClassification } from '@/lib/membership/classification';

// Tracks an anonymous, in-progress signup (email submitted, awaiting OTP verification, then a
// password) without creating a `users` row until the password step completes — so an abandoned
// signup never leaves an orphaned, passwordless account behind. Deliberately separate from the
// real session cookie/signing surface in lib/auth/session.ts.
const COOKIE_NAME = 'idoc_pending_signup';
const LIFETIME_MS = 15 * 60 * 1000;
const signingKey = () => new TextEncoder().encode(authSecretForServer());

// csrfNonce: see lib/security/csrf.ts's generatePendingCsrfNonce doc comment -- minted once by
// startPendingSignup (the flow's only entry point) and carried forward unchanged by
// markPendingSignupVerified, so the general CSRF cookie's real, confirmed client-side-navigation
// staleness risk never applies to this flow's own forms.
type PendingSignup = {
  csrfNonce: string;
  email: string;
  emailDisplay: string;
  membership: MemberClassification | null;
  verified: boolean;
};

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

export async function startPendingSignup(email: string, emailDisplay: string, membership: MemberClassification | null = null) {
  await setPendingSignupCookie({ csrfNonce: generatePendingCsrfNonce(), email, emailDisplay, membership, verified: false });
}

export async function markPendingSignupVerified(pending: PendingSignup) {
  await setPendingSignupCookie({ ...pending, verified: true });
}

export async function getPendingSignup(): Promise<PendingSignup | null> {
  const token = (await requestCookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || typeof payload.emailDisplay !== 'string' || typeof payload.verified !== 'boolean' ||
      typeof payload.csrfNonce !== 'string' || payload.csrfNonce.length < 16) return null;
    return {
      csrfNonce: payload.csrfNonce,
      email: payload.email,
      emailDisplay: payload.emailDisplay,
      membership: parseMemberClassification(typeof payload.membership === 'string' ? payload.membership : null),
      verified: payload.verified,
    };
  } catch {
    return null;
  }
}

export async function clearPendingSignup() {
  (await requestCookies()).delete(COOKIE_NAME);
}
