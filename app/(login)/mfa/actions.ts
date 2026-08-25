'use server';

import { eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { validatedAction } from '@/lib/auth/middleware';
import { clearPendingLogin } from '@/lib/auth/pending-login';
import { setSession } from '@/lib/auth/session';
import { revokeAllUserSessions } from '@/lib/auth/session-registry';
import { users } from '@/lib/db/schema';
import { db } from '@/lib/db/drizzle';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';
import { mfaConfiguration } from '@/lib/runtime/configuration';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { clearPendingPrimaryAuth, getPendingPrimaryAuth, setPendingPrimaryAuth } from '@/lib/auth/mfa/pending-primary-auth';
import { consumeRecoveryCode, replaceRecoveryCodes } from '@/lib/auth/mfa/recovery';
import { mfaStore } from '@/lib/auth/mfa/store';
import { beginTotpEnrollment, completeTotpEnrollment, verifyActiveTotp } from '@/lib/auth/mfa/totp';

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

async function pendingAccount(expected: 'challenge' | 'enrollment' | 'recovery-entry' | 'replacement' | 'recovery-ack') {
  const pending = await getPendingPrimaryAuth();
  if (!pending || pending.stage !== expected || pending.applicationId !== MFA_APPLICATION_ID) return null;
  const [user] = await db.select().from(users).where(eq(users.id, pending.subjectId)).limit(1);
  if (!user || !['active', 'onboarding'].includes(user.accountState) || !user.emailVerifiedAt || user.deletedAt ||
    user.sessionVersion !== pending.sessionVersion) return null;
  const role = await authoritativeMfaRole(user.id);
  if (role !== 'admin' && role !== 'super-admin') return null;
  return { pending, user };
}

async function allowed(userId: number, purpose: string) {
  return checkRateLimit(purpose, String(userId), await requestOrigin());
}

async function failAndRestart(message: string) {
  await clearPendingPrimaryAuth();
  await clearPendingLogin();
  return { error: message };
}

export const verifyLoginTotp = validatedAction(codeSchema, async ({ code }) => {
  const context = await pendingAccount('challenge');
  if (!context) return failAndRestart('Your verification session expired. Sign in again.');
  if (!(await allowed(context.user.id, 'mfa_login_verify'))) return { error: 'Too many attempts. Sign in again later.' };
  const config = mfaConfiguration();
  const result = await verifyActiveTotp({ applicationId: MFA_APPLICATION_ID, code, purpose: 'login',
    resolveKey: (keyId) => { const key = config.encryptionKeys.get(keyId); if (!key) throw new Error('MFA key unavailable.'); return key; },
    store: mfaStore, subjectId: String(context.user.id), transactionId: context.pending.transactionId });
  if (result.status === 'invalid-code') return { error: 'That authenticator code is incorrect.' };
  if (result.status !== 'accepted') return failAndRestart(result.status === 'attempts-exhausted'
    ? 'Too many incorrect codes. Sign in again.' : 'Your verification session expired. Sign in again.');
  await clearPendingPrimaryAuth();
  await clearPendingLogin();
  await setSession(context.user);
  redirect(context.pending.returnTo);
});

export const beginAuthenticatorRecovery = validatedAction(z.object({ recover: z.literal('yes') }), async () => {
  const context = await pendingAccount('challenge');
  if (!context) return failAndRestart('Your verification session expired. Sign in again.');
  await setPendingPrimaryAuth({ ...context.pending, stage: 'recovery-entry' });
  return { success: 'Enter one of your recovery codes.' };
});

export const authorizeAuthenticatorRecovery = validatedAction(z.object({ recoveryCode: z.string().trim().min(1).max(64) }), async ({ recoveryCode }) => {
  const context = await pendingAccount('recovery-entry');
  if (!context) return failAndRestart('Your recovery session expired. Sign in again.');
  if (!(await allowed(context.user.id, 'mfa_recovery_code_verify'))) return failAndRestart('Too many attempts. Sign in again later.');
  const config = mfaConfiguration();
  const recovery = await consumeRecoveryCode({ applicationId: MFA_APPLICATION_ID, code: recoveryCode,
    digestSecrets: [config.recoveryDigestKey], store: mfaStore, subjectId: String(context.user.id) });
  if (recovery.status !== 'recovery-authorized') return { error: 'That recovery code could not be used.' };
  const enrollment = await beginTotpEnrollment({ accountLabel: context.user.email, applicationId: MFA_APPLICATION_ID,
    encryptionKey: config.encryptionKeys.get(config.activeKeyId)!, issuer: 'IDOC', keyId: config.activeKeyId,
    purpose: 'authenticator-replacement', store: mfaStore, subjectId: String(context.user.id) });
  await setPendingPrimaryAuth({ ...context.pending, factorId: enrollment.factorId, stage: 'replacement',
    transactionId: enrollment.transactionId });
  redirect('/mfa');
});

export const confirmTotpEnrollment = validatedAction(codeSchema, async ({ code }) => {
  const pending = await getPendingPrimaryAuth();
  const stage = pending?.stage === 'replacement' ? 'replacement' : 'enrollment';
  const context = await pendingAccount(stage);
  if (!context) return failAndRestart('Your setup session expired. Sign in again.');
  if (!(await allowed(context.user.id, 'mfa_enrollment_confirm'))) return { error: 'Too many attempts. Sign in again later.' };
  const config = mfaConfiguration();
  const result = await completeTotpEnrollment({ applicationId: MFA_APPLICATION_ID, code,
    factorId: context.pending.factorId,
    purpose: stage === 'replacement' ? 'authenticator-replacement' : 'mfa-enrollment',
    resolveKey: (keyId) => { const key = config.encryptionKeys.get(keyId); if (!key) throw new Error('MFA key unavailable.'); return key; },
    store: mfaStore, subjectId: String(context.user.id), transactionId: context.pending.transactionId });
  if (result.status === 'invalid-code') return { error: 'That authenticator code is incorrect.' };
  if (result.status !== 'activated') return failAndRestart('Your setup session expired. Sign in again.');
  let sessionVersion = context.user.sessionVersion;
  if (stage === 'replacement') {
    const [updated] = await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, context.user.id)).returning({ sessionVersion: users.sessionVersion });
    if (!updated) return failAndRestart('Your setup session expired. Sign in again.');
    sessionVersion = updated.sessionVersion;
    await revokeAllUserSessions(context.user.id, 'authenticator-replacement');
  }
  const recovery = await replaceRecoveryCodes({ applicationId: MFA_APPLICATION_ID,
    digestSecret: config.recoveryDigestKey, store: mfaStore, subjectId: String(context.user.id) });
  await setPendingPrimaryAuth({ ...context.pending, sessionVersion, stage: 'recovery-ack' });
  return { recoveryCodes: recovery.codes, success: stage === 'replacement'
    ? 'Authenticator replaced. Save these new recovery codes now.' : 'Authenticator enabled. Save these recovery codes now.' };
});

export const acknowledgeRecoveryCodes = validatedAction(z.object({ saved: z.literal('yes') }), async () => {
  const context = await pendingAccount('recovery-ack');
  if (!context) return failAndRestart('Your setup session expired. Sign in again.');
  const activeFactor = await mfaStore.getActiveTotp(String(context.user.id), MFA_APPLICATION_ID);
  if (!activeFactor || activeFactor.factorId !== context.pending.factorId) return failAndRestart('Your setup session expired. Sign in again.');
  await clearPendingPrimaryAuth();
  await clearPendingLogin();
  await setSession(context.user);
  redirect(context.pending.returnTo);
});

export const cancelMfa = validatedAction(z.object({ cancel: z.literal('yes') }), async () => {
  await clearPendingPrimaryAuth();
  await clearPendingLogin();
  redirect('/sign-in');
});
