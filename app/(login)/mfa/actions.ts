'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { validatedAction } from '@/lib/auth/middleware';
import { clearPendingLogin } from '@/lib/auth/pending-login';
import { setSession } from '@/lib/auth/session';
import { users } from '@/lib/db/schema';
import { db } from '@/lib/db/drizzle';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';
import { mfaConfiguration } from '@/lib/runtime/configuration';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { clearPendingPrimaryAuth, getPendingPrimaryAuth, setPendingPrimaryAuth } from '@/lib/auth/mfa/pending-primary-auth';
import { consumeRecoveryCode, prepareRecoveryCodes, replaceRecoveryCodes } from '@/lib/auth/mfa/recovery';
import { finalizeAuthenticatorReplacement } from '@/lib/auth/mfa/replacement-finalization';
import { mfaStore } from '@/lib/auth/mfa/store';
import { beginTotpEnrollment, completeTotpEnrollment, decryptTotpSecret, verifyActiveTotp, verifyTotpCode } from '@/lib/auth/mfa/totp';
import { getPendingStepUp, grantFreshStepUp } from '@/lib/auth/mfa/step-up';

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

export const verifyStepUpTotp = validatedAction(codeSchema, async ({ code }) => {
  const context = await getPendingStepUp();
  if (!context) return { error: 'Your verification session expired. Try the action again.' };
  if (!(await allowed(context.user.id, 'mfa_step_up_verify'))) return { error: 'Too many attempts. Try again later.' };
  const config = mfaConfiguration();
  const result = await verifyActiveTotp({ applicationId: MFA_APPLICATION_ID, code, purpose: 'step-up',
    resolveKey: (keyId) => { const key = config.encryptionKeys.get(keyId); if (!key) throw new Error('MFA key unavailable.'); return key; },
    store: mfaStore, subjectId: String(context.user.id), transactionId: context.pending.transactionId });
  if (result.status === 'invalid-code') return { error: 'That authenticator code is incorrect.' };
  if (result.status !== 'accepted') return { error: result.status === 'attempts-exhausted'
    ? 'Too many incorrect codes. Try the action again.' : 'Your verification session expired. Try the action again.' };
  await grantFreshStepUp(context.pending);
  redirect(context.pending.returnTo);
});

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
  const resolveKey = (keyId: string) => { const key = config.encryptionKeys.get(keyId); if (!key) throw new Error('MFA key unavailable.'); return key; };

  if (stage === 'replacement') {
    const nowMs = Date.now();
    const enrollment = await mfaStore.getPendingTotpEnrollment({
      applicationId: MFA_APPLICATION_ID, factorId: context.pending.factorId, nowMs,
      subjectId: String(context.user.id), transactionId: context.pending.transactionId,
    });
    if (!enrollment || enrollment.enrollment.purpose !== 'authenticator-replacement' ||
      enrollment.factor.status !== 'pending' || enrollment.enrollment.consumedAtMs !== null ||
      enrollment.enrollment.expiresAtMs <= nowMs) return failAndRestart('Your setup session expired. Sign in again.');
    const acceptedCounter = verifyTotpCode(decryptTotpSecret(enrollment.factor.encryptedSecret, resolveKey), code, nowMs);
    if (acceptedCounter === null) return { error: 'That authenticator code is incorrect.' };

    const recovery = prepareRecoveryCodes({ applicationId: MFA_APPLICATION_ID,
      digestSecret: config.recoveryDigestKey, nowMs, subjectId: String(context.user.id) });
    const nextSessionVersion = context.user.sessionVersion + 1;

    // Write the fail-closed continuation first. If the database transaction below rolls back,
    // this cookie cannot validate because the user's sessionVersion will still be the old value.
    await setPendingPrimaryAuth({ ...context.pending, sessionVersion: nextSessionVersion, stage: 'recovery-ack' });
    const result = await finalizeAuthenticatorReplacement({ acceptedCounter, applicationId: MFA_APPLICATION_ID,
      expectedSessionVersion: context.user.sessionVersion, factorId: context.pending.factorId, nowMs,
      recoveryCodes: recovery.records, recoveryGenerationId: recovery.generationId,
      transactionId: context.pending.transactionId, userId: context.user.id });
    if (result.status !== 'activated' || result.sessionVersion !== nextSessionVersion) {
      return failAndRestart('Your setup session expired. Sign in again.');
    }
    return { recoveryCodes: recovery.codes, success: 'Authenticator replaced. Save these new recovery codes now.' };
  }

  const result = await completeTotpEnrollment({ applicationId: MFA_APPLICATION_ID, code,
    factorId: context.pending.factorId, purpose: 'mfa-enrollment', resolveKey, store: mfaStore,
    subjectId: String(context.user.id), transactionId: context.pending.transactionId });
  if (result.status === 'invalid-code') return { error: 'That authenticator code is incorrect.' };
  if (result.status !== 'activated') return failAndRestart('Your setup session expired. Sign in again.');
  const recovery = await replaceRecoveryCodes({ applicationId: MFA_APPLICATION_ID,
    digestSecret: config.recoveryDigestKey, store: mfaStore, subjectId: String(context.user.id) });
  await setPendingPrimaryAuth({ ...context.pending, stage: 'recovery-ack' });
  return { recoveryCodes: recovery.codes, success: 'Authenticator enabled. Save these recovery codes now.' };
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
