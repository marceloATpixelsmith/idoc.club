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
import { replaceRecoveryCodes } from '@/lib/auth/mfa/recovery';
import { mfaStore } from '@/lib/auth/mfa/store';
import { completeTotpEnrollment, verifyActiveTotp } from '@/lib/auth/mfa/totp';

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

async function pendingAccount(expected: 'challenge' | 'enrollment' | 'recovery-ack') {
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

export const confirmTotpEnrollment = validatedAction(codeSchema, async ({ code }) => {
  const context = await pendingAccount('enrollment');
  if (!context) return failAndRestart('Your setup session expired. Sign in again.');
  if (!(await allowed(context.user.id, 'mfa_enrollment_confirm'))) return { error: 'Too many attempts. Sign in again later.' };
  const config = mfaConfiguration();
  const result = await completeTotpEnrollment({ applicationId: MFA_APPLICATION_ID, code,
    factorId: context.pending.factorId,
    resolveKey: (keyId) => { const key = config.encryptionKeys.get(keyId); if (!key) throw new Error('MFA key unavailable.'); return key; },
    store: mfaStore, subjectId: String(context.user.id), transactionId: context.pending.transactionId });
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
