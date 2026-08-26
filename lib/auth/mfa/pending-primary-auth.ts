import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { mfaConfiguration } from '@/lib/runtime/configuration';

const COOKIE_NAME = 'idoc_pending_primary_mfa';
const TTL_SECONDS = 10 * 60;

export type PendingPrimaryAuth = {
  applicationId: 'idoc.club';
  factorId: string;
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
  (await cookies()).set(COOKIE_NAME, token, options(new Date(Date.now() + TTL_SECONDS * 1000)));
}

export async function getPendingPrimaryAuth(): Promise<PendingPrimaryAuth | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, mfaConfiguration().continuationKey, { algorithms: ['HS256'] });
    if (payload.applicationId !== 'idoc.club' || !Number.isSafeInteger(payload.subjectId) ||
      !Number.isSafeInteger(payload.sessionVersion) || typeof payload.factorId !== 'string' ||
      typeof payload.transactionId !== 'string' || !['google', 'password'].includes(String(payload.method)) ||
      !['challenge', 'enrollment', 'recovery-entry', 'replacement', 'recovery-ack'].includes(String(payload.stage)) || typeof payload.returnTo !== 'string') return null;
    return payload as unknown as PendingPrimaryAuth;
  } catch { return null; }
}

export async function clearPendingPrimaryAuth() { (await cookies()).delete(COOKIE_NAME); }
