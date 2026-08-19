'use server';

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/drizzle';
import { users, type NewUser } from '@/lib/db/schema';
import { hashPassword, setSession } from '@/lib/auth/session';
import { validatedAction } from '@/lib/auth/middleware';
import { normalizeEmail } from '@/lib/membership/validation';
import { passwordSchema } from '@/lib/auth/password-policy';
import { issueEmailOtp, verifyEmailOtp } from '@/lib/auth/email-otp';
import { verifyTurnstile } from '@/lib/auth/turnstile';
import { clearPendingSignup, getPendingSignup, markPendingSignupVerified, startPendingSignup } from '@/lib/auth/pending-signup';
import { defaultTiming, equalizeAnonymousResponse } from '@/lib/security/response-timing';
import { requestOrigin } from '@/lib/security/rate-limit';

const startSignupSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(255),
  turnstileToken: z.string().min(1, 'Please complete the verification challenge.'),
});

/** Neutral outward behavior regardless of whether the email already has an account: an existing
 * account never receives a signup code (issueEmailOtp is skipped), but the response shape and
 * timing are indistinguishable from a brand-new email, so a caller cannot use this step to probe
 * account existence. Anyone who actually controls an existing inbox learns nothing new here either
 * — they simply never receive a code and stay stuck at the same verify screen a wrong email would
 * produce. */
export const startSignup = validatedAction(startSignupSchema, async ({ email: rawEmail, turnstileToken }) => {
  const startedAt = defaultTiming.now();
  const email = normalizeEmail(rawEmail);
  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin))) {
    return { email, error: 'Verification challenge failed. Please try again.' };
  }
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  let issueError: string | null = null;
  if (!existing) {
    const result = await issueEmailOtp(email, 'signup_verification', { origin });
    if (result.status === 'rate_limited') issueError = 'Too many attempts. Please try again in a few minutes.';
    if (result.status === 'delivery_failed') issueError = 'We could not send that verification code. Please try again in a moment.';
  }
  await equalizeAnonymousResponse(startedAt, defaultTiming);
  if (issueError) return { email, error: issueError };
  await startPendingSignup(email);
  redirect('/sign-up');
});

const verifyOtpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

export const verifySignupOtp = validatedAction(verifyOtpSchema, async ({ code }) => {
  const pending = await getPendingSignup();
  if (!pending) return { error: 'Your signup session expired. Start again.' };
  const origin = await requestOrigin();
  const result = await verifyEmailOtp(pending.email, 'signup_verification', code, origin);
  if (result === 'verified') {
    await markPendingSignupVerified(pending.email);
    redirect('/sign-up');
  }
  if (result === 'expired') return { error: 'This code expired. Request a new one.' };
  if (result === 'locked') return { error: 'Too many incorrect attempts. Request a new code.' };
  if (result === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  return { error: 'That code is incorrect.' };
});

export const resendSignupOtp = validatedAction(z.object({}), async () => {
  const pending = await getPendingSignup();
  if (!pending) return { error: 'Your signup session expired. Start again.' };
  const origin = await requestOrigin();
  const result = await issueEmailOtp(pending.email, 'signup_verification', { origin });
  if (result.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  if (result.status === 'cooldown') return { error: 'Please wait before requesting another code.' };
  if (result.status === 'delivery_failed') return { error: 'We could not send that verification code. Please try again in a moment.' };
  return { success: 'A new code was sent.' };
});

export const cancelSignup = validatedAction(z.object({}), async () => {
  await clearPendingSignup();
  redirect('/sign-up');
});

const completeSignupSchema = z.object({ password: passwordSchema });

export const completeSignup = validatedAction(completeSignupSchema, async ({ password }) => {
  const pending = await getPendingSignup();
  if (!pending || !pending.verified) return { error: 'Your signup session expired. Start again.' };
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, pending.email)).limit(1);
  if (existing) { await clearPendingSignup(); return { error: 'An account with this email already exists. Sign in instead.' }; }
  const newUser: NewUser = {
    accountState: 'onboarding', email: pending.email, emailVerifiedAt: new Date(),
    passwordHash: await hashPassword(password), role: 'member',
  };
  const [createdUser] = await db.insert(users).values(newUser).returning();
  if (!createdUser) return { error: 'Something went wrong creating your account. Please try again.' };
  await clearPendingSignup();
  await setSession(createdUser);
  redirect('/onboarding');
});
