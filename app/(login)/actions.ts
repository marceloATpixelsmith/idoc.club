'use server';

import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { clearSession, comparePasswords, hashPassword, passwordHashNeedsUpgrade, setSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  validatedAction,
  validatedActionWithUser
} from '@/lib/auth/middleware';
import { normalizeEmail } from '@/lib/membership/validation';
import { deleteOwnAccount } from '@/lib/membership/data-access';
import { issueEmailVerification } from '@/lib/membership/email-verification';
import { passwordSchema } from '@/lib/auth/password-policy';
import { consumeAccountToken, requestAccountLink } from '@/lib/membership/account-recovery';
import { issueEmailOtp } from '@/lib/auth/email-otp';
import { getPendingLogin, requireLoginOtp } from '@/lib/auth/pending-login';
import { requestOrigin } from '@/lib/security/rate-limit';
import { authoritativeMfaRole, beginPrimaryMfa } from '@/lib/auth/mfa/login';
import { hasValidLoginDeviceTrust } from '@/lib/auth/login-device-trust';
import { consumeFreshStepUp, requireFreshStepUp } from '@/lib/auth/mfa/step-up';

const signInSchema = z.object({
  email: z.string().email().min(3).max(255),
  // Login verifies the existing credential exactly as supplied. Creation policy belongs only on
  // password creation/change boundaries and must not strand a valid legacy credential.
  password: z.string().min(1).max(128)
});

/** Canonical login ordering from pixelsmith-auth-reference contract 1.9.0:
 * email -> password -> authoritative email-verification gate -> MFA/risk -> session.
 * Migrated/imported status is not a public login branch. */
export const signIn = validatedAction(signInSchema, async (data) => {
  const { password } = data;
  const email = normalizeEmail(data.email);
  const pending = await getPendingLogin();
  if (!pending || pending.stage !== 'password' || pending.email !== email) {
    return { error: 'Your sign-in session expired. Start again.', email };
  }

  const matchingUsers = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (matchingUsers.length === 0) return { error: 'Invalid email or password. Please try again.', email };

  const foundUser = matchingUsers[0];
  const isPasswordValid = await comparePasswords(password, foundUser.passwordHash);

  if (!isPasswordValid || !['active', 'onboarding', 'migrated_pending'].includes(foundUser.accountState)) {
    return { error: 'Invalid email or password. Please try again.', email };
  }

  if (passwordHashNeedsUpgrade(foundUser.passwordHash)) {
    const upgradedHash = await hashPassword(password);
    await db.update(users)
      .set({ passwordHash: upgradedHash, updatedAt: new Date() })
      .where(and(eq(users.id, foundUser.id), eq(users.passwordHash, foundUser.passwordHash)));
  }

  const role = await authoritativeMfaRole(foundUser.id);

  if (!foundUser.emailVerifiedAt) {
    const origin = await requestOrigin();
    const issued = await issueEmailOtp(email, 'login_verification', { origin, userId: foundUser.id });
    if (issued.status === 'delivery_failed') {
      return { error: 'We could not send the verification code. Please try again.', email };
    }
    if (issued.status === 'rate_limited') {
      return { error: 'Too many attempts. Please try again in a few minutes.', email };
    }
    await requireLoginOtp(email, foundUser.id, foundUser.sessionVersion,
      role === 'member' && foundUser.accountState !== 'migrated_pending');
    redirect('/sign-in');
  }

  if (foundUser.accountState === 'migrated_pending') {
    const origin = await requestOrigin();
    const issued = await issueEmailOtp(email, 'login_verification', { origin, userId: foundUser.id });
    if (issued.status === 'delivery_failed') return { error: 'We could not send the verification code. Please try again.', email };
    if (issued.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.', email };
    await requireLoginOtp(email, foundUser.id, foundUser.sessionVersion, false);
    redirect('/sign-in');
  }

  if (role === 'member') {
    if (await hasValidLoginDeviceTrust(foundUser)) {
      await setSession(foundUser);
      redirect('/dashboard');
    }
    const origin = await requestOrigin();
    const issued = await issueEmailOtp(email, 'login_verification', { origin, userId: foundUser.id });
    if (issued.status === 'delivery_failed') return { error: 'We could not send the verification code. Please try again.', email };
    if (issued.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.', email };
    await requireLoginOtp(email, foundUser.id, foundUser.sessionVersion, true);
    redirect('/sign-in');
  }

  if (await beginPrimaryMfa(foundUser, 'password', '/dashboard')) redirect('/mfa');
  await setSession(foundUser);
  redirect('/dashboard');
});

const accountLinkSchema = z.object({ email: z.string().email().max(255) });
const NEUTRAL_RECOVERY = 'If an eligible account uses this address, an email will be sent.';

export const requestPasswordRecovery = validatedAction(accountLinkSchema, async ({ email }) => {
  const requestHeaders = await headers();
  const origin = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? requestHeaders.get('x-real-ip') ?? 'unknown';
  await requestAccountLink(email, 'password_reset', origin);
  return { success: NEUTRAL_RECOVERY };
});

export const requestMigrationActivation = validatedAction(accountLinkSchema, async ({ email }) => {
  const requestHeaders = await headers();
  const origin = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? requestHeaders.get('x-real-ip') ?? 'unknown';
  await requestAccountLink(email, 'migration_activation', origin);
  return { success: NEUTRAL_RECOVERY };
});

const consumeTokenSchema = z.object({ confirmPassword: passwordSchema, password: passwordSchema, token: z.string().max(100) })
  .refine(({ confirmPassword, password }) => confirmPassword === password, { message: 'Passwords do not match.' });

export const resetPassword = validatedAction(consumeTokenSchema, async ({ password, token }) => {
  const result = await consumeAccountToken(token, 'password_reset', password);
  return result.status === 'success' ? { success: 'Your password was reset. Sign in again on every device.' } : { error: 'This reset link is invalid or expired.' };
});

export const activateMigratedAccount = validatedAction(consumeTokenSchema, async ({ password, token }) => {
  const result = await consumeAccountToken(token, 'migration_activation', password);
  return result.status === 'success' ? { success: 'Your account is active. Sign in to review your imported profile.' } : { error: 'This activation link is invalid or expired.' };
});

const resendVerificationSchema = z.object({ email: z.string().email().max(255) });

export const resendVerification = validatedAction(resendVerificationSchema, async (data) => {
  const email = normalizeEmail(data.email);
  const [user] = await db.select({ emailVerifiedAt: users.emailVerifiedAt, id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (user && !user.emailVerifiedAt) await issueEmailVerification(user.id, email);
  return { success: 'If an unverified account uses this address, a verification email will be sent.' };
});

export async function signOut() {
  await clearSession();
}

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
  confirmPassword: passwordSchema
});

export const updatePassword = validatedActionWithUser(
  updatePasswordSchema,
  async (data, _, user) => {
    const { currentPassword, newPassword, confirmPassword } = data;

    if ((await requireFreshStepUp(user, 'change-password', '/dashboard/security')).required) redirect('/mfa');

    const isPasswordValid = await comparePasswords(currentPassword, user.passwordHash);
    if (!isPasswordValid) return { error: 'Current password is incorrect.' };
    if (currentPassword === newPassword) return { error: 'New password must be different from the current password.' };
    if (confirmPassword !== newPassword) return { error: 'New password and confirmation password do not match.' };

    const newPasswordHash = await hashPassword(newPassword);
    await db.update(users).set({
      passwordHash: newPasswordHash,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));
    await consumeFreshStepUp();
    return { success: 'Password updated successfully.' };
  }
);

const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });

export const deleteAccount = validatedActionWithUser(
  deleteAccountSchema,
  async (data, _, user) => {
    const isPasswordValid = await comparePasswords(data.password, user.passwordHash);
    if (!isPasswordValid) return { error: 'Incorrect password. Account deletion failed.' };
    await deleteOwnAccount();
    await clearSession();
    redirect('/sign-in');
  }
);

const updateAccountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address')
});

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user) => {
    const name = data.name;
    const email = normalizeEmail(data.email);
    if (email !== user.email) {
      if ((await requireFreshStepUp(user, 'change-email', '/dashboard/account')).required) redirect('/mfa');
      const [duplicate] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (duplicate) return { error: 'That email address is unavailable.', name };
      await db.update(users).set({ name }).where(eq(users.id, user.id));
      await issueEmailVerification(user.id, email);
      await consumeFreshStepUp();
      return { name, success: 'Check the new address to verify your email change.' };
    }
    await db.update(users).set({ name }).where(eq(users.id, user.id));
    return { name, success: 'Account updated successfully.' };
  }
);
