import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { applicationRoles, type User } from '@/lib/db/schema';
import { db } from '@/lib/db/drizzle';
import { mfaConfiguration } from '@/lib/runtime/configuration';
import { decideMfa } from './decision';
import { mfaStore } from './store';
import { beginTotpEnrollment } from './totp';
import { setPendingPrimaryAuth } from './pending-primary-auth';
import type { MfaRole } from './types';

export const MFA_APPLICATION_ID = 'idoc.club';

export async function authoritativeMfaRole(userId: number): Promise<MfaRole> {
  const grants = await db.select({ role: applicationRoles.role }).from(applicationRoles)
    .where(and(eq(applicationRoles.userId, userId), isNull(applicationRoles.revokedAt)));
  if (grants.some(({ role }) => role === 'super_admin')) return 'super-admin';
  if (grants.some(({ role }) => role === 'administrator')) return 'admin';
  return 'member';
}

export async function beginPrimaryMfa(user: User, method: 'google' | 'password', returnTo: string) {
  const subjectId = String(user.id);
  const role = await authoritativeMfaRole(user.id);
  const factor = await mfaStore.getActiveTotp(subjectId, MFA_APPLICATION_ID);
  const decision = decideMfa({ hasActiveTotp: Boolean(factor), rememberedDeviceValid: false,
    rememberTotpDevice: false, requirement: 'privileged-users', role });
  if (decision === 'not-required') return false;
  if (decision === 'challenge-required' && factor) {
    const transactionId = randomUUID();
    await mfaStore.createChallenge({ applicationId: MFA_APPLICATION_ID, maxAttempts: 5, nowMs: Date.now(),
      purpose: 'login', subjectId, transactionId, expiresAtMs: Date.now() + 10 * 60 * 1000 });
    await setPendingPrimaryAuth({ applicationId: MFA_APPLICATION_ID, factorId: factor.factorId, method,
      returnTo, sessionVersion: user.sessionVersion, stage: 'challenge', subjectId: user.id, transactionId });
    return true;
  }
  const config = mfaConfiguration();
  const enrollment = await beginTotpEnrollment({ accountLabel: user.email, applicationId: MFA_APPLICATION_ID,
    encryptionKey: config.encryptionKeys.get(config.activeKeyId)!, issuer: 'IDOC', keyId: config.activeKeyId,
    store: mfaStore, subjectId });
  await setPendingPrimaryAuth({ applicationId: MFA_APPLICATION_ID, factorId: enrollment.factorId, method,
    returnTo, sessionVersion: user.sessionVersion, stage: 'enrollment', subjectId: user.id,
    transactionId: enrollment.transactionId });
  return true;
}
