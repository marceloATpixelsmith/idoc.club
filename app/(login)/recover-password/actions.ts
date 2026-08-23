'use server';

import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { hashPassword, setSession } from '@/lib/auth/session';
import { validatedAction } from '@/lib/auth/middleware';
import { normalizeEmail } from '@/lib/membership/validation';
import { passwordSchema } from '@/lib/auth/password-policy';
import { issueEmailOtp, verifyEmailOtp } from '@/lib/auth/email-otp';
import { verifyTurnstile } from '@/lib/auth/turnstile';
import { defaultTiming, equalizeAnonymousResponse } from '@/lib/security/response-timing';
import { clearPendingPasswordReset, getPendingPasswordReset, markPendingPasswordResetVerified, startPendingPasswordReset } from '@/lib/auth/pending-password-reset';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';

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
  if (eligible) await issueEmailOtp(email, 'password_reset', { origin, userId: user.id });
  await equalizeAnonymousResponse(startedAt, defaultTiming);
  await startPendingPasswordReset(email);
  redirect('/recover-password');
});

const verifyOtpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

export const verifyPasswordResetOtp = validatedAction(verifyOtpSchema, async ({ code }) => {
  const pending = await getPendingPasswordReset();
  if (!pending) return { error: 'Your session expired. Start again.' };
  const origin = await requestOrigin();
  const result = await verifyEmailOtp(pending.email, 'password_reset', code, origin);
  if (result === 'verified') {
    await markPendingPasswordResetVerified(pending.email);
    redirect('/recover-password');
  }
  if (result === 'expired') return { error: 'This code expired. Request a new one.' };
  if (result === 'locked') return { error: 'Too many incorrect attempts. Request a new code.' };
  if (result === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  return { error: 'That code is incorrect.' };
});

export const resendPasswordResetOtp = validatedAction(z.object({}), async () => {
  const pending = await getPendingPasswordReset();
  if (!pending) return { error: 'Your session expired. Start again.' };
  const origin = await requestOrigin();
  const result = await issueEmailOtp(pending.email, 'password_reset', { origin });
  if (result.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  if (result.status === 'cooldown') return { error: 'Please wait before requesting another code.' };
  if (result.status === 'delivery_failed') return { error: 'We could not send that verification code. Please try again in a moment.' };
  return { success: 'A new code was sent.' };
});

export const cancelPasswordReset = validatedAction(z.object({}), async () => {
  await clearPendingPasswordReset();
  redirect('/recover-password');
});

const completeResetSchema = z.object({ password: passwordSchema });

export const completePasswordReset = validatedAction(completeResetSchema, async ({ password }) => {
  const pending = await getPendingPasswordReset();
  if (!pending || !pending.verified) return { error: 'Your session expired. Start again.' };
  const [user] = await db.select({ accountState: users.accountState, id: users.id }).from(users).where(eq(users.email, pending.email)).limit(1);
  if (!user || !['active', 'onboarding'].includes(user.accountState)) {
    await clearPendingPasswordReset();
    return { error: 'This account is no longer eligible for a password reset.' };
  }
  await db.update(users).set({ passwordHash: await hashPassword(password), sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() }).where(eq(users.id, user.id));
  await clearPendingPasswordReset();
  const [updated] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (updated) await setSession(updated);
  redirect('/dashboard');
});
