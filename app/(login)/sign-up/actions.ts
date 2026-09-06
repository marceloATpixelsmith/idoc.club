'use server';

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/drizzle';
import { users, type NewUser } from '@/lib/db/schema';
import { hashPassword, rawCanonicalSessionId, rawCanonicalUserId, setSession } from '@/lib/auth/session';
import { validatedAction } from '@/lib/auth/middleware';
import { emailDisplayForm, normalizeEmail } from '@/lib/membership/validation';
import { passwordSchema } from '@/lib/auth/password-policy';
import { checkPasswordBreached } from '@/lib/security/password-breach-check';
import { notifyWebmasterOfBreachedPasswordAttempt } from '@/lib/notifications/breached-password-alert';
import { issueEmailOtp, verifyEmailOtp } from '@/lib/auth/email-otp';
import { verifyTurnstile } from '@/lib/auth/turnstile';
import { clearPendingSignup, getPendingSignup, markPendingSignupVerified, startPendingSignup } from '@/lib/auth/pending-signup';
import { defaultTiming, equalizeAnonymousResponse } from '@/lib/security/response-timing';
import { requestOrigin } from '@/lib/security/rate-limit';
import { requireCsrfTokenOrPendingNonce } from '@/lib/security/csrf';
import { parseMemberClassification } from '@/lib/membership/classification';

const startSignupSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(255),
  membership: z.string().optional(),
  turnstileToken: z.string().min(1, 'Please complete the verification challenge.'),
});

/** Neutral outward behavior regardless of whether the email already has an account: an existing
 * account never receives a signup code, while outward response shape/timing remain neutral. */
export const startSignup = validatedAction(startSignupSchema, async ({ email: rawEmail, membership: rawMembership, turnstileToken }) => {
  const startedAt = defaultTiming.now();
  const email = normalizeEmail(rawEmail);
  const emailDisplay = emailDisplayForm(rawEmail);
  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin, 'signup'))) {
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
  const membership = parseMemberClassification(rawMembership);
  await startPendingSignup(email, emailDisplay, membership);
  // The signup steps intentionally share one pathname, but a distinct query target forces the
  // browser/RSC tree to navigate after the HttpOnly pending-signup cookie changes.
  redirect('/sign-up?stage=verify');
});

const verifyOtpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

export const verifySignupOtp = validatedAction(verifyOtpSchema, async ({ code }, formData) => {
  const pending = await getPendingSignup();
  if (!pending) return { error: 'Your signup session expired. Start again.' };
  await requireCsrfTokenOrPendingNonce(formData, await rawCanonicalSessionId(), await rawCanonicalUserId(), pending.csrfNonce);
  const origin = await requestOrigin();
  const result = await verifyEmailOtp(pending.email, 'signup_verification', code, origin);
  if (result === 'verified') {
    await markPendingSignupVerified(pending);
    redirect('/sign-up?stage=password');
  }
  if (result === 'expired') return { error: 'This code expired. Request a new one.' };
  if (result === 'locked') return { error: 'Too many incorrect attempts. Request a new code.' };
  if (result === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  return { error: 'That code is incorrect.' };
}, { skipCsrf: true });

export const resendSignupOtp = validatedAction(z.object({}), async (_data, formData) => {
  const pending = await getPendingSignup();
  if (!pending) return { error: 'Your signup session expired. Start again.' };
  await requireCsrfTokenOrPendingNonce(formData, await rawCanonicalSessionId(), await rawCanonicalUserId(), pending.csrfNonce);
  const origin = await requestOrigin();
  const result = await issueEmailOtp(pending.email, 'signup_verification', { origin });
  if (result.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  if (result.status === 'cooldown') return { error: 'Please wait before requesting another code.' };
  if (result.status === 'delivery_failed') return { error: 'We could not send that verification code. Please try again in a moment.' };
  return { success: 'A new code was sent.' };
}, { skipCsrf: true });

export const cancelSignup = validatedAction(z.object({}), async (_data, formData) => {
  const pending = await getPendingSignup();
  await requireCsrfTokenOrPendingNonce(formData, await rawCanonicalSessionId(), await rawCanonicalUserId(), pending?.csrfNonce ?? null);
  await clearPendingSignup();
  redirect('/sign-up');
}, { skipCsrf: true });

const completeSignupSchema = z.object({ password: passwordSchema });

export const completeSignup = validatedAction(completeSignupSchema, async ({ password }, formData) => {
  const pending = await getPendingSignup();
  if (!pending || !pending.verified) return { error: 'Your signup session expired. Start again.' };
  await requireCsrfTokenOrPendingNonce(formData, await rawCanonicalSessionId(), await rawCanonicalUserId(), pending.csrfNonce);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, pending.email)).limit(1);
  if (existing) { await clearPendingSignup(); return { error: 'An account with this email already exists. Sign in instead.' }; }
  if ((await checkPasswordBreached(password)).breached) {
    await notifyWebmasterOfBreachedPasswordAttempt({ email: pending.email, source: 'signup' });
    return { error: 'This password has appeared in a public data breach. Please choose a different password.' };
  }
  const newUser: NewUser = {
    accountState: 'onboarding', email: pending.email, emailDisplay: pending.emailDisplay, emailVerifiedAt: new Date(),
    passwordHash: await hashPassword(password), role: 'member',
  };
  const [createdUser] = await db.insert(users).values(newUser).returning();
  if (!createdUser) return { error: 'Something went wrong creating your account. Please try again.' };
  await clearPendingSignup();
  await setSession(createdUser);
  const membershipQuery = pending.membership ? `?membership=${pending.membership}` : '';
  redirect(`/dashboard${membershipQuery}`);
}, { skipCsrf: true });
