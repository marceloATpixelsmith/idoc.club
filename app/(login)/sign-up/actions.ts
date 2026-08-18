'use server';

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
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

async function requestOrigin() {
  const requestHeaders = await headers();
  return requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? requestHeaders.get('x-real-ip') ?? 'unknown';
}

const startSignupSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(255),
  turnstileToken: z.string().min(1, 'Please complete the verification challenge.'),
});

export const startSignup = validatedAction(startSignupSchema, async ({ email: rawEmail, turnstileToken }) => {
  const email = normalizeEmail(rawEmail);
  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin))) {
    return { email, error: 'Verification challenge failed. Please try again.' };
  }
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { email, error: 'An account with this email already exists. Sign in instead.' };
  const result = await issueEmailOtp(email, 'signup_verification', { origin });
  if (result.status === 'rate_limited') return { email, error: 'Too many attempts. Please try again in a few minutes.' };
  if (result.status === 'cooldown') { /* a code was already just sent; proceed to the same verify step */ }
  await startPendingSignup(email);
  redirect('/sign-up');
});

const verifyOtpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

export const verifySignupOtp = validatedAction(verifyOtpSchema, async ({ code }) => {
  const pending = await getPendingSignup();
  if (!pending) return { error: 'Your signup session expired. Start again.' };
  const result = await verifyEmailOtp(pending.email, 'signup_verification', code);
  if (result === 'verified') {
    await markPendingSignupVerified(pending.email);
    redirect('/sign-up');
  }
  if (result === 'expired') return { error: 'This code expired. Request a new one.' };
  if (result === 'locked') return { error: 'Too many incorrect attempts. Request a new code.' };
  return { error: 'That code is incorrect.' };
});

export const resendSignupOtp = validatedAction(z.object({}), async () => {
  const pending = await getPendingSignup();
  if (!pending) return { error: 'Your signup session expired. Start again.' };
  const origin = await requestOrigin();
  const result = await issueEmailOtp(pending.email, 'signup_verification', { origin });
  if (result.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  if (result.status === 'cooldown') return { error: 'Please wait before requesting another code.' };
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
