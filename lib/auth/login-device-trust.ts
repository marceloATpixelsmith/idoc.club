import 'server-only';

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db } from '@/lib/db/drizzle';
import { loginTrustedDevices, users } from '@/lib/db/schema';
import { loginDeviceTrustDigestKeyForServer } from '@/lib/runtime/configuration';
import { MFA_APPLICATION_ID } from './mfa/login';

export const LOGIN_DEVICE_TRUST_LIFETIME_SECONDS = 14 * 24 * 60 * 60;
export const LOGIN_DEVICE_TRUST_COOKIE = '__Host-idoc-login-device';

function digest(token: string) {
  return createHmac('sha256', loginDeviceTrustDigestKeyForServer()).update(token).digest('hex');
}

function clearCookie() {
  return cookies().then((store) => store.set(LOGIN_DEVICE_TRUST_COOKIE, '', {
    expires: new Date(0), httpOnly: true, maxAge: 0, path: '/', sameSite: 'lax', secure: true,
  }));
}

export async function hasValidLoginDeviceTrust(user: { id: number; sessionVersion: number }, now = new Date()) {
  const token = (await cookies()).get(LOGIN_DEVICE_TRUST_COOKIE)?.value;
  if (!token) return false;
  const [record] = await db.select({ id: loginTrustedDevices.trustedDeviceId })
    .from(loginTrustedDevices)
    .innerJoin(users, eq(users.id, loginTrustedDevices.userId))
    .where(and(
      eq(loginTrustedDevices.tokenDigest, digest(token)),
      eq(loginTrustedDevices.userId, user.id),
      eq(loginTrustedDevices.applicationId, MFA_APPLICATION_ID),
      eq(loginTrustedDevices.sessionVersionAtIssue, user.sessionVersion),
      eq(users.sessionVersion, user.sessionVersion),
      isNull(users.deletedAt),
      inArray(users.accountState, ['active', 'onboarding']),
      isNull(loginTrustedDevices.revokedAt),
      gt(loginTrustedDevices.expiresAt, now),
    )).limit(1);
  return Boolean(record);
}

export async function issueLoginDeviceTrust(user: { id: number; sessionVersion: number }, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + LOGIN_DEVICE_TRUST_LIFETIME_SECONDS * 1000);
  await db.insert(loginTrustedDevices).values({
    applicationId: MFA_APPLICATION_ID,
    expiresAt,
    issuedAt: now,
    sessionVersionAtIssue: user.sessionVersion,
    tokenDigest: digest(token),
    trustedDeviceId: randomUUID(),
    userId: user.id,
  });
  (await cookies()).set(LOGIN_DEVICE_TRUST_COOKIE, token, {
    expires: expiresAt,
    httpOnly: true,
    maxAge: LOGIN_DEVICE_TRUST_LIFETIME_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: true,
  });
}

export async function revokeLoginDeviceTrustForUser(userId: number, reason: string, now = new Date()) {
  await db.update(loginTrustedDevices).set({ revokeReason: reason, revokedAt: now }).where(and(
    eq(loginTrustedDevices.userId, userId),
    eq(loginTrustedDevices.applicationId, MFA_APPLICATION_ID),
    isNull(loginTrustedDevices.revokedAt),
  ));
}

/** Revokes only the server-read credential for this user and application. */
export async function forgetCurrentLoginDevice(userId: number, reason = 'member-forgot-device', now = new Date()) {
  const token = (await cookies()).get(LOGIN_DEVICE_TRUST_COOKIE)?.value;
  if (token) {
    await db.update(loginTrustedDevices).set({ revokeReason: reason, revokedAt: now }).where(and(
      eq(loginTrustedDevices.tokenDigest, digest(token)),
      eq(loginTrustedDevices.userId, userId),
      eq(loginTrustedDevices.applicationId, MFA_APPLICATION_ID),
      isNull(loginTrustedDevices.revokedAt),
    ));
  }
  await clearCookie();
}

export async function forgetAllLoginDevices(userId: number, reason = 'member-forgot-all-devices') {
  await revokeLoginDeviceTrustForUser(userId, reason);
  await clearCookie();
}
