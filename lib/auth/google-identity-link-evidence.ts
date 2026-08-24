import 'server-only';

import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { authSecretForServer } from '@/lib/runtime/configuration';

export const GOOGLE_LINK_FRESH_AUTH_MAX_AGE_MS = 5 * 60 * 1000;
const COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-idoc-google-link' : 'idoc-google-link';
const signingKey = () => new TextEncoder().encode(authSecretForServer());

export type GoogleIdentityLinkFreshEvidence = {
  userId: string;
  verifiedAtMs: number;
  purpose: 'external_identity_link' | 'external_identity_unlink';
  method: 'password';
  transactionId: string;
};

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/' as const,
    maxAge: 5 * 60,
  };
}

export async function issueGoogleLinkFreshEvidence(userId: number): Promise<GoogleIdentityLinkFreshEvidence> {
  const verifiedAtMs = Date.now();
  const evidence: GoogleIdentityLinkFreshEvidence = {
    userId: String(userId),
    verifiedAtMs,
    purpose: 'external_identity_link',
    method: 'password',
    transactionId: randomUUID(),
  };
  const token = await new SignJWT(evidence)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor((verifiedAtMs + GOOGLE_LINK_FRESH_AUTH_MAX_AGE_MS) / 1000))
    .sign(signingKey());
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, cookieOptions());
  return evidence;
}

export async function readGoogleLinkFreshEvidence(expectedUserId: number): Promise<GoogleIdentityLinkFreshEvidence | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (
      payload.purpose !== 'external_identity_link' ||
      payload.method !== 'password' ||
      payload.userId !== String(expectedUserId) ||
      typeof payload.verifiedAtMs !== 'number' ||
      typeof payload.transactionId !== 'string'
    ) return null;
    const age = Date.now() - payload.verifiedAtMs;
    if (age < 0 || age > GOOGLE_LINK_FRESH_AUTH_MAX_AGE_MS) return null;
    return {
      userId: payload.userId,
      verifiedAtMs: payload.verifiedAtMs,
      purpose: 'external_identity_link',
      method: 'password',
      transactionId: payload.transactionId,
    };
  } catch {
    return null;
  }
}

export async function clearGoogleLinkFreshEvidence() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, '', { ...cookieOptions(), expires: new Date(0), maxAge: 0 });
}

export function createImmediateGoogleUnlinkFreshEvidence(userId: number): GoogleIdentityLinkFreshEvidence {
  return {
    userId: String(userId),
    verifiedAtMs: Date.now(),
    purpose: 'external_identity_unlink',
    method: 'password',
    transactionId: randomUUID(),
  };
}
