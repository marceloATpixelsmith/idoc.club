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
const neutralVerificationError = { error: 'That verification code is incorrect or expired.' };

export const verifyPasswordResetOtp = validatedAction(verifyOtpSchema, async ({ code }) => {
  const pending = await getPendingPasswordReset();
  if (!pending || pending.stage === 'authorized') return { error: 'Your session expired. Start again.' };
  const origin = await requestOrigin();

  if (pending.stage === 'email-otp') {
    if (!pending.subjectId) {
      await checkRateLimit('password_reset_verify_neutral', pending.email, origin);
      return neutralVerificationError;
    }
    if ((await authoritativeMfaRole(pending.subjectId)) !== 'member') {
      await clearPendingPasswordReset();
      return neutralVerificationError;
    }
    const result = await verifyEmailOtp(pending.email, 'password_reset', code, origin);
    if (result === 'verified') {
      await authorizePendingPasswordReset(pending, 'email-otp');
      redirect('/recover-password');
    }
    return result === 'rate_limited'
      ? { error: 'Too many attempts. Please try again in a few minutes.' }
      : neutralVerificationError;
  }

  if (pending.stage === 'missing-factor') {
    await checkRateLimit('mfa_password_reset_verify', String(pending.subjectId), origin);
    return neutralVerificationError;
  }

  const role = await authoritativeMfaRole(pending.subjectId);
  if (role !== 'admin' && role !== 'super-admin') {
    await clearPendingPasswordReset();
    return neutralVerificationError;
  }
  if (!(await checkRateLimit('mfa_password_reset_verify', String(pending.subjectId), origin))) {
    return { error: 'Too many attempts. Please try again in a few minutes.' };
  }
  const config = mfaConfiguration();
  const result = await verifyActiveTotp({ applicationId: MFA_APPLICATION_ID, code, purpose: 'password-reset',
    resolveKey: (keyId) => { const key = config.encryptionKeys.get(keyId); if (!key) throw new Error('MFA key unavailable.'); return key; },
    store: mfaStore, subjectId: String(pending.subjectId), transactionId: pending.transactionId });
  if (result.status !== 'accepted') {
    if (result.status === 'attempts-exhausted' || result.status === 'invalid-transaction') await clearPendingPasswordReset();
    return neutralVerificationError;
  }
  await authorizePendingPasswordReset(pending, 'totp');
  redirect('/recover-password');
});

export const resendPasswordResetOtp = validatedAction(z.object({}), async () => {
  const pending = await getPendingPasswordReset();
  if (!pending || pending.stage === 'authorized') return { error: 'Your session expired. Start again.' };
  const origin = await requestOrigin();
  if (pending.stage === 'email-otp' && pending.subjectId &&
    (await authoritativeMfaRole(pending.subjectId)) === 'member') {
    await issueEmailOtp(pending.email, 'password_reset', { origin });
  } else {
    await checkRateLimit('password_reset_resend_neutral', pending.email, origin);
  }
  return { success: 'If email verification is available for this account, a new code was sent.' };
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
        sql`${users.accountState} in ('active', 'onboarding')`)).returning({ id: users.id, sessionVersion: users.sessionVersion });
    if (!updated) throw new Error('Password reset target became unavailable.');
    await tx.update(authSessions).set({ revokedAt: new Date(), revokeReason: 'password-reset', updatedAt: new Date() })
      .where(and(eq(authSessions.userId, user.id), isNull(authSessions.revokedAt)));
    await tx.execute(sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,reason)
      values(${user.id},'account.password_reset.completed','user',${String(user.id)},${pending.verification})`);
    await tx.execute(sql`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
      values(${user.id},'password_reset_completed',${user.email},${`password-reset:${user.id}:${updated.sessionVersion}`})
      on conflict (dedupe_key) where dedupe_key is not null do nothing`);
  });
  await clearPendingPasswordReset();
  redirect('/sign-in?reset=success');
});
