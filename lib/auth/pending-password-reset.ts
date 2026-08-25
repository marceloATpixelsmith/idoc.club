import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { authSecretForServer } from '@/lib/runtime/configuration';

const COOKIE_NAME = 'idoc_pending_password_reset';
const LIFETIME_MS = 15 * 60 * 1000;
const signingKey = () => new TextEncoder().encode(authSecretForServer());

export type PendingPasswordReset =
  | { email: string; stage: 'email-otp'; subjectId?: number }
  | { email: string; stage: 'totp'; subjectId: number; transactionId: string }
  | { email: string; stage: 'missing-factor'; subjectId: number }
  | { email: string; stage: 'authorized'; subjectId: number; verification: 'email-otp' | 'totp' };

async function setPendingPasswordResetCookie(data: PendingPasswordReset) {
  const token = await new SignJWT(data).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setExpirationTime('15m').sign(signingKey());
  (await cookies()).set(COOKIE_NAME, token, {
    expires: new Date(Date.now() + LIFETIME_MS), httpOnly: true, sameSite: 'lax', secure: true,
  });
}

export async function startPendingPasswordReset(data: PendingPasswordReset) {
  await setPendingPasswordResetCookie(data);
}

export async function authorizePendingPasswordReset(
  current: PendingPasswordReset,
  verification: 'email-otp' | 'totp',
) {
  if (!current.subjectId) throw new Error('Invalid password-reset authorization.');
  await setPendingPasswordResetCookie({ email: current.email, stage: 'authorized',
    subjectId: current.subjectId, verification });
}

export async function getPendingPasswordReset(): Promise<PendingPasswordReset | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || typeof payload.stage !== 'string') return null;
    if (payload.stage === 'email-otp' && (payload.subjectId === undefined || typeof payload.subjectId === 'number')) {
      return { email: payload.email, stage: payload.stage, subjectId: payload.subjectId };
    }
    if ((payload.stage === 'totp' && typeof payload.transactionId === 'string') && typeof payload.subjectId === 'number') {
      return { email: payload.email, stage: payload.stage, subjectId: payload.subjectId,
        transactionId: payload.transactionId };
    }
    if (payload.stage === 'missing-factor' && typeof payload.subjectId === 'number') {
      return { email: payload.email, stage: payload.stage, subjectId: payload.subjectId };
    }
    if (payload.stage === 'authorized' && typeof payload.subjectId === 'number' &&
      (payload.verification === 'email-otp' || payload.verification === 'totp')) {
      return { email: payload.email, stage: payload.stage, subjectId: payload.subjectId,
        verification: payload.verification };
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearPendingPasswordReset() {
  (await cookies()).delete(COOKIE_NAME);
}
