'use server';

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { setSession } from '@/lib/auth/session';
import { validatedAction } from '@/lib/auth/middleware';
import { normalizeEmail } from '@/lib/membership/validation';
import { passwordSchema } from '@/lib/auth/password-policy';
import { issueEmailOtp, verifyEmailOtp } from '@/lib/auth/email-otp';
import { verifyTurnstile } from '@/lib/auth/turnstile';
import { activateMigratedAccountByUserId } from '@/lib/membership/account-recovery';
import { clearPendingLogin, getPendingLogin, markPendingLoginVerified, startPendingLogin } from '@/lib/auth/pending-login';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';

const startLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(255),
  turnstileToken: z.string().min(1, 'Please complete the verification challenge.'),
});

/** The email-first boundary is intentionally account-existence neutral. After a valid bot challenge
 * and rate-limit decision, every syntactically valid email advances to the password step. Password
 * verification then returns the same generic failure for unknown, unverified, suspended, deleted,
 * or otherwise ineligible accounts. Legacy migrated members use the separate neutral activation
 * flow; the retained legacy-OTP handlers below preserve compatibility for already-started flows. */
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

export const verifyLoginOtp = validatedAction(verifyOtpSchema, async ({ code }) => {
  const pending = await getPendingLogin();
  if (!pending || !pending.legacy) return { error: 'Your sign-in session expired. Start again.' };
  const origin = await requestOrigin();
  const result = await verifyEmailOtp(pending.email, 'login_verification', code, origin);
  if (result === 'verified') {
    await markPendingLoginVerified(pending.email);
    redirect('/sign-in');
  }
  if (result === 'expired') return { error: 'This code expired. Request a new one.' };
  if (result === 'locked') return { error: 'Too many incorrect attempts. Request a new code.' };
  if (result === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  return { error: 'That code is incorrect.' };
});

export const resendLoginOtp = validatedAction(z.object({}), async () => {
  const pending = await getPendingLogin();
  if (!pending || !pending.legacy) return { error: 'Your sign-in session expired. Start again.' };
  const origin = await requestOrigin();
  const result = await issueEmailOtp(pending.email, 'login_verification', { origin });
  if (result.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  if (result.status === 'cooldown') return { error: 'Please wait before requesting another code.' };
  if (result.status === 'delivery_failed') return { error: 'We could not send that verification code. Please try again in a moment.' };
  return { success: 'A new code was sent.' };
});

export const cancelLogin = validatedAction(z.object({}), async () => {
  await clearPendingLogin();
  redirect('/sign-in');
});

const activateSchema = z.object({ password: passwordSchema });

export const activateLegacyAccount = validatedAction(activateSchema, async ({ password }) => {
  const pending = await getPendingLogin();
  if (!pending || !pending.legacy || !pending.verified) return { error: 'Your sign-in session expired. Start again.' };
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, pending.email)).limit(1);
  if (!user) { await clearPendingLogin(); return { error: 'Your sign-in session expired. Start again.' }; }
  const result = await activateMigratedAccountByUserId(user.id, password);
  if (result.status !== 'success') {
    return { error: 'We could not activate your account automatically. Contact IDOC for help.' };
  }
  await clearPendingLogin();
  const [activated] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (activated) await setSession(activated);
  redirect('/dashboard/profile?confirmDetails=1');
});
