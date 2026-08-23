'use server';

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { setSession } from '@/lib/auth/session';
import { validatedAction } from '@/lib/auth/middleware';
import { normalizeEmail } from '@/lib/membership/validation';
import { issueEmailOtp, verifyEmailOtp } from '@/lib/auth/email-otp';
import { verifyTurnstile } from '@/lib/auth/turnstile';
import { clearPendingLogin, getPendingLogin, startPendingLogin } from '@/lib/auth/pending-login';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';

const startLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(255),
  turnstileToken: z.string().min(1, 'Please complete the verification challenge.'),
});

/** Canonical entry behavior: the anonymous email step never performs account-state routing and
 * never sends an email verification code. It establishes only a short-lived, signed continuation
 * for the password step after Turnstile and layered rate limiting succeed. */
export const startLogin = validatedAction(startLoginSchema, async ({ email: rawEmail, turnstileToken }) => {
  const email = normalizeEmail(rawEmail);
  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin, 'login'))) {
    return { email, error: 'Verification challenge failed. Please try again.' };
  }
  if (!(await checkRateLimit('login_email', email, origin))) {
    return { email, error: 'Too many attempts. Please try again in a few minutes.' };
  }

  await startPendingLogin(email, false);
  redirect('/sign-in');
});

const verifyOtpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

/** This OTP exists only after the primary password credential has succeeded for an account whose
 * authoritative email state is still unverified. Successful verification persists that state before
 * normal session establishment. */
export const verifyLoginOtp = validatedAction(verifyOtpSchema, async ({ code }) => {
  const pending = await getPendingLogin();
  if (!pending || !pending.legacy || pending.verified) return { error: 'Your sign-in session expired. Start again.' };

  const origin = await requestOrigin();
  const result = await verifyEmailOtp(pending.email, 'login_verification', code, origin);
  if (result === 'expired') return { error: 'This code expired. Request a new one.' };
  if (result === 'locked') return { error: 'Too many incorrect attempts. Request a new code.' };
  if (result === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  if (result !== 'verified') return { error: 'That code is incorrect.' };

  const [user] = await db.select().from(users).where(eq(users.email, pending.email)).limit(1);
  if (!user || !['active', 'onboarding', 'migrated_pending'].includes(user.accountState)) {
    await clearPendingLogin();
    return { error: 'Your sign-in session expired. Start again.' };
  }

  const now = new Date();
  await db.update(users).set({
    emailVerifiedAt: user.emailVerifiedAt ?? now,
    accountState: user.accountState === 'migrated_pending' ? 'active' : user.accountState,
    updatedAt: now,
  }).where(and(eq(users.id, user.id), eq(users.email, pending.email)));

  await clearPendingLogin();
  const [verifiedUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!verifiedUser) return { error: 'Your sign-in session expired. Start again.' };
  await setSession(verifiedUser);
  redirect(user.accountState === 'migrated_pending' ? '/dashboard/profile?confirmDetails=1' : '/dashboard');
});

export const resendLoginOtp = validatedAction(z.object({}), async () => {
  const pending = await getPendingLogin();
  if (!pending || !pending.legacy || pending.verified) return { error: 'Your sign-in session expired. Start again.' };
  const origin = await requestOrigin();
  const [account] = await db.select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt })
    .from(users).where(eq(users.email, pending.email)).limit(1);
  if (account && !account.emailVerifiedAt) {
    await issueEmailOtp(pending.email, 'login_verification', { origin, userId: account.id });
  }
  return { success: 'If this address still requires verification, a new code was sent.' };
});

export const cancelLogin = validatedAction(z.object({}), async () => {
  await clearPendingLogin();
  redirect('/sign-in');
});
