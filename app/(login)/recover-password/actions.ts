'use server';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/drizzle';
import { authSessions, users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/auth/session';
import { validatedAction } from '@/lib/auth/middleware';
import { normalizeEmail } from '@/lib/membership/validation';
import { passwordSchema } from '@/lib/auth/password-policy';
import { issueEmailOtp, verifyEmailOtp } from '@/lib/auth/email-otp';
import { verifyTurnstile } from '@/lib/auth/turnstile';
import { defaultTiming, equalizeAnonymousResponse } from '@/lib/security/response-timing';
import { authorizePendingPasswordReset, clearPendingPasswordReset, getPendingPasswordReset, startPendingPasswordReset } from '@/lib/auth/pending-password-reset';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { mfaStore } from '@/lib/auth/mfa/store';
import { verifyActiveTotp } from '@/lib/auth/mfa/totp';
import { mfaConfiguration } from '@/lib/runtime/configuration';

const startResetSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(255),
  turnstileToken: z.string().min(1, 'Please complete the verification challenge.'),
});

/** Neutral anonymous boundary: outward behavior and timing are indistinguishable regardless of
 * whether the email belongs to an eligible account. */
export const startPasswordReset = validatedAction(startResetSchema, async ({ email: rawEmail, turnstileToken }) => {
  const startedAt = defaultTiming.now();
  const email = normalizeEmail(rawEmail);
  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin, 'password-reset'))) {
    return { email, error: 'Verification challenge failed. Please try again.' };
  }
  if (!(await checkRateLimit('password_reset_email', email, origin))) {
    await equalizeAnonymousResponse(startedAt, defaultTiming);
    return { email, error: 'Too many attempts. Please try again in a few minutes.' };
  }
  const [user] = await db.select({ accountState: users.accountState, id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const eligible = user && ['active', 'onboarding'].includes(user.accountState);
  let continuation: Parameters<typeof startPendingPasswordReset>[0] = { email, stage: 'email-otp' };
  if (eligible) {
    const role = await authoritativeMfaRole(user.id);
    if (role === 'admin' || role === 'super-admin') {
      const factor = await mfaStore.getActiveTotp(String(user.id), MFA_APPLICATION_ID);
      if (factor) {
        const transactionId = randomUUID();
        await mfaStore.createChallenge({ applicationId: MFA_APPLICATION_ID, expiresAtMs: Date.now() + 10 * 60 * 1000,
          maxAttempts: 5, nowMs: Date.now(), purpose: 'password-reset', subjectId: String(user.id), transactionId });
        continuation = { email, stage: 'totp', subjectId: user.id, transactionId };
      } else continuation = { email, stage: 'missing-factor', subjectId: user.id };
    } else {
      await issueEmailOtp(email, 'password_reset', { origin, userId: user.id });
      continuation = { email, stage: 'email-otp', subjectId: user.id };
    }
  }
  await equalizeAnonymousResponse(startedAt, defaultTiming);
  await startPendingPasswordReset(continuation);
  redirect('/recover-password');
});

const verifyOtpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

export const verifyPasswordResetOtp = validatedAction(verifyOtpSchema, async ({ code }) => {
  const pending = await getPendingPasswordReset();
  if (!pending || pending.stage !== 'email-otp' || !pending.subjectId) return { error: 'Your session expired. Start again.' };
  if ((await authoritativeMfaRole(pending.subjectId)) !== 'member') {
    await clearPendingPasswordReset();
    return { error: 'Your recovery requirements changed. Start again.' };
  }
  const origin = await requestOrigin();
  const result = await verifyEmailOtp(pending.email, 'password_reset', code, origin);
  if (result === 'verified') {
    await authorizePendingPasswordReset(pending, 'email-otp');
    redirect('/recover-password');
  }
  if (result === 'expired') return { error: 'This code expired. Request a new one.' };
  if (result === 'locked') return { error: 'Too many incorrect attempts. Request a new code.' };
  if (result === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  return { error: 'That code is incorrect.' };
});

export const resendPasswordResetOtp = validatedAction(z.object({}), async () => {
  const pending = await getPendingPasswordReset();
  if (!pending || pending.stage !== 'email-otp' || !pending.subjectId ||
    (await authoritativeMfaRole(pending.subjectId)) !== 'member') {
    await clearPendingPasswordReset();
    return { error: 'Your session expired. Start again.' };
  }
  const origin = await requestOrigin();
  const result = await issueEmailOtp(pending.email, 'password_reset', { origin });
  if (result.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  if (result.status === 'cooldown') return { error: 'Please wait before requesting another code.' };
  if (result.status === 'delivery_failed') return { error: 'We could not send that verification code. Please try again in a moment.' };
  return { success: 'A new code was sent.' };
});

export const verifyPasswordResetTotp = validatedAction(verifyOtpSchema, async ({ code }) => {
  const pending = await getPendingPasswordReset();
  if (!pending || pending.stage !== 'totp') return { error: 'Your verification session expired. Start again.' };
  const role = await authoritativeMfaRole(pending.subjectId);
  if (role !== 'admin' && role !== 'super-admin') {
    await clearPendingPasswordReset();
    return { error: 'Your recovery requirements changed. Start again.' };
  }
  if (!(await checkRateLimit('mfa_password_reset_verify', String(pending.subjectId), await requestOrigin()))) {
    return { error: 'Too many attempts. Start again later.' };
  }
  const config = mfaConfiguration();
  const result = await verifyActiveTotp({ applicationId: MFA_APPLICATION_ID, code, purpose: 'password-reset',
    resolveKey: (keyId) => { const key = config.encryptionKeys.get(keyId); if (!key) throw new Error('MFA key unavailable.'); return key; },
    store: mfaStore, subjectId: String(pending.subjectId), transactionId: pending.transactionId });
  if (result.status === 'invalid-code') return { error: 'That authenticator code is incorrect.' };
  if (result.status !== 'accepted') {
    await clearPendingPasswordReset();
    return { error: result.status === 'attempts-exhausted' ? 'Too many incorrect codes. Start again.' : 'Your verification session expired. Start again.' };
  }
  await authorizePendingPasswordReset(pending, 'totp');
  redirect('/recover-password');
});

export const cancelPasswordReset = validatedAction(z.object({}), async () => {
  await clearPendingPasswordReset();
  redirect('/recover-password');
});

const completeResetSchema = z.object({ password: passwordSchema });

export const completePasswordReset = validatedAction(completeResetSchema, async ({ password }) => {
  const pending = await getPendingPasswordReset();
  if (!pending || pending.stage !== 'authorized') return { error: 'Your session expired. Start again.' };
  const [user] = await db.select({ accountState: users.accountState, deletedAt: users.deletedAt, email: users.email, id: users.id })
    .from(users).where(and(eq(users.id, pending.subjectId), eq(users.email, pending.email))).limit(1);
  if (!user || !['active', 'onboarding'].includes(user.accountState) || user.deletedAt) {
    await clearPendingPasswordReset();
    return { error: 'This account is no longer eligible for a password reset.' };
  }
  const role = await authoritativeMfaRole(user.id);
  const privileged = role === 'admin' || role === 'super-admin';
  if ((privileged && pending.verification !== 'totp') || (!privileged && pending.verification !== 'email-otp' && pending.verification !== 'totp')) {
    await clearPendingPasswordReset();
    return { error: 'Your recovery requirements changed. Start again.' };
  }
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(users).set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
      .where(and(eq(users.id, user.id), eq(users.email, pending.email), isNull(users.deletedAt),
        sql`${users.accountState} in ('active', 'onboarding')`)).returning({ id: users.id });
    if (!updated) throw new Error('Password reset target became unavailable.');
    await tx.update(authSessions).set({ revokedAt: new Date(), revokeReason: 'password-reset', updatedAt: new Date() })
      .where(and(eq(authSessions.userId, user.id), isNull(authSessions.revokedAt)));
  });
  await clearPendingPasswordReset();
  redirect('/sign-in?reset=success');
});
