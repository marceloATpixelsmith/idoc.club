'use server';

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
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

async function requestOrigin() {
  const requestHeaders = await headers();
  return requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? requestHeaders.get('x-real-ip') ?? 'unknown';
}

const startLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(255),
  turnstileToken: z.string().min(1, 'Please complete the verification challenge.'),
});

/** Deliberately reveals whether the email has an account: this is a login flow (the user is already
 * proving they know the email they signed up with), not the neutral anonymous recovery/activation
 * boundary in lib/membership/account-recovery.ts, which stays neutral. */
export const startLogin = validatedAction(startLoginSchema, async ({ email: rawEmail, turnstileToken }) => {
  const email = normalizeEmail(rawEmail);
  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin))) {
    return { email, error: 'Verification challenge failed. Please try again.' };
  }
  const [user] = await db.select({ accountState: users.accountState, id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.accountState === 'deleted') return { email, error: 'No account was found with that email address.' };
  if (user.accountState === 'suspended') return { email, error: 'This account is suspended. Contact IDOC for help.' };
  if (user.accountState === 'migrated_pending') {
    const result = await issueEmailOtp(email, 'login_verification', { origin, userId: user.id });
    if (result.status === 'rate_limited') return { email, error: 'Too many attempts. Please try again in a few minutes.' };
    await startPendingLogin(email, true);
    redirect('/sign-in');
  }
  await startPendingLogin(email, false);
  redirect('/sign-in');
});

const verifyOtpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

export const verifyLoginOtp = validatedAction(verifyOtpSchema, async ({ code }) => {
  const pending = await getPendingLogin();
  if (!pending || !pending.legacy) return { error: 'Your sign-in session expired. Start again.' };
  const result = await verifyEmailOtp(pending.email, 'login_verification', code);
  if (result === 'verified') {
    await markPendingLoginVerified(pending.email);
    redirect('/sign-in');
  }
  if (result === 'expired') return { error: 'This code expired. Request a new one.' };
  if (result === 'locked') return { error: 'Too many incorrect attempts. Request a new code.' };
  return { error: 'That code is incorrect.' };
});

export const resendLoginOtp = validatedAction(z.object({}), async () => {
  const pending = await getPendingLogin();
  if (!pending || !pending.legacy) return { error: 'Your sign-in session expired. Start again.' };
  const origin = await requestOrigin();
  const result = await issueEmailOtp(pending.email, 'login_verification', { origin });
  if (result.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.' };
  if (result.status === 'cooldown') return { error: 'Please wait before requesting another code.' };
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
