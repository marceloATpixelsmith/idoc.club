'use server';

import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { clearSession, comparePasswords, hashPassword, passwordHashNeedsUpgrade, rawCanonicalSessionId, setSession } from '@/lib/auth/session';
import { requireCsrfTokenValue } from '@/lib/security/csrf';
import { redirect } from 'next/navigation';
import {
  validatedAction,
  validatedActionWithUser
} from '@/lib/auth/middleware';
import { emailDisplayForm, normalizeEmail } from '@/lib/membership/validation';
import { deleteOwnAccount } from '@/lib/membership/data-access';
import { issueEmailVerification } from '@/lib/membership/email-verification';
import { passwordEntrySchema, passwordSchema } from '@/lib/auth/password-policy';
import { consumeAccountToken, requestAccountLink } from '@/lib/membership/account-recovery';
import { issueEmailOtp } from '@/lib/auth/email-otp';
import { clearPendingLogin, getPendingLogin, requireLoginOtp } from '@/lib/auth/pending-login';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';
import { authoritativeMfaRole, beginPrimaryMfa } from '@/lib/auth/mfa/login';
import { forgetAllLoginDevices, hasValidLoginDeviceTrust } from '@/lib/auth/login-device-trust';
import { revokeAllUserSessions } from '@/lib/auth/session-registry';
import { consumeFreshStepUp, requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { checkPasswordBreached } from '@/lib/security/password-breach-check';
import { notifyWebmasterOfBreachedPasswordAttempt } from '@/lib/notifications/breached-password-alert';

const signInSchema = z.object({
  email: z.string().email().min(3).max(255),
  // Login verifies the existing credential exactly as supplied. Creation policy belongs only on
  // password creation/change boundaries and must not strand a valid legacy credential.
  password: passwordEntrySchema
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

  // Independent dual-bucket throttle on the credential comparison itself (distinct from the
  // Turnstile+rate-limited email-collection step that gates entry into this pending-login stage):
  // without this, holding one valid pending-login cookie let comparePasswords() be called an
  // unlimited number of times within its lifetime.
  if (!(await checkRateLimit('login_password', email, await requestOrigin()))) {
    return { error: 'Too many attempts. Please try again in a few minutes.', email };
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
      // Re-resolve the authoritative role immediately before accepting the ordinary-device bypass.
      // If a privilege grant committed after the initial read, reload the user row before starting
      // privileged MFA so the pending continuation carries the new server-owned sessionVersion.
      const currentRole = await authoritativeMfaRole(foundUser.id);
      if (currentRole === 'member') {
        await clearPendingLogin();
        await setSession(foundUser);
        redirect('/dashboard');
      }
      const [currentUser] = await db.select().from(users).where(and(
        eq(users.id, foundUser.id),
        eq(users.email, foundUser.email),
      )).limit(1);
      if (!currentUser || currentUser.deletedAt || !['active', 'onboarding'].includes(currentUser.accountState)) {
        await clearPendingLogin();
        return { error: 'Your sign-in session expired. Start again.', email };
      }
      if (await beginPrimaryMfa(currentUser, 'password', '/dashboard')) {
        await clearPendingLogin();
        redirect('/mfa');
      }
      return { error: 'Your sign-in session expired. Start again.', email };
    }
    const origin = await requestOrigin();
    const issued = await issueEmailOtp(email, 'login_verification', { origin, userId: foundUser.id });
    if (issued.status === 'delivery_failed') return { error: 'We could not send the verification code. Please try again.', email };
    if (issued.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.', email };
    await requireLoginOtp(email, foundUser.id, foundUser.sessionVersion, true);
    redirect('/sign-in');
  }

  if (await beginPrimaryMfa(foundUser, 'password', '/dashboard')) {
    await clearPendingLogin();
    redirect('/mfa');
  }
  await clearPendingLogin();
  await setSession(foundUser);
  redirect('/dashboard');
});

const accountLinkSchema = z.object({ email: z.string().email().max(255) });
const NEUTRAL_RECOVERY = 'If an eligible account uses this address, an email will be sent.';

export const requestPasswordRecovery = validatedAction(accountLinkSchema, async ({ email }) => {
  const origin = await requestOrigin();
  await requestAccountLink(email, 'password_reset', origin);
  return { success: NEUTRAL_RECOVERY };
});

export const requestMigrationActivation = validatedAction(accountLinkSchema, async ({ email }) => {
  const origin = await requestOrigin();
  await requestAccountLink(email, 'migration_activation', origin);
  return { success: NEUTRAL_RECOVERY };
});

const consumeTokenSchema = z.object({ confirmPassword: passwordSchema, password: passwordSchema, token: z.string().max(100) })
  .refine(({ confirmPassword, password }) => confirmPassword === password, { message: 'Passwords do not match.' });

const breachedPasswordError = { error: 'This password has appeared in a public data breach. Please choose a different password.' };

export const resetPassword = validatedAction(consumeTokenSchema, async ({ password, token }) => {
  const result = await consumeAccountToken(token, 'password_reset', password);
  if (result.status === 'success') return { success: 'Your password was reset. Sign in again on every device.' };
  return result.status === 'breached_password' ? breachedPasswordError : { error: 'This reset link is invalid or expired.' };
});

export const activateMigratedAccount = validatedAction(consumeTokenSchema, async ({ password, token }) => {
  const result = await consumeAccountToken(token, 'migration_activation', password);
  if (result.status === 'success') return { success: 'Your account is active. Sign in to review your imported profile.' };
  return result.status === 'breached_password' ? breachedPasswordError : { error: 'This activation link is invalid or expired.' };
});

const resendVerificationSchema = z.object({ email: z.string().email().max(255) });

export const resendVerification = validatedAction(resendVerificationSchema, async (data) => {
  const email = normalizeEmail(data.email);
  const [user] = await db.select({ emailVerifiedAt: users.emailVerifiedAt, id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (user && !user.emailVerifiedAt) await issueEmailVerification(user.id, data.email);
  return { success: 'If an unverified account uses this address, a verification email will be sent.' };
});

export async function signOut(csrfToken: string) {
  // AUTH-CSRF-001 explicitly includes logout among mutations requiring CSRF validation, even
  // though signing out an already-forged session mainly harms the attacker's own forged state --
  // it is still cookie-authenticated, state-changing, and invoked directly (not via a <form>), so it
  // is checked the same way as every other JS-invoked Server Action.
  await requireCsrfTokenValue(csrfToken, await rawCanonicalSessionId());
  await clearSession();
}

const updatePasswordSchema = z.object({
  currentPassword: passwordEntrySchema,
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
    if ((await checkPasswordBreached(newPassword)).breached) {
      await notifyWebmasterOfBreachedPasswordAttempt({ email: user.email, source: 'password-change' });
      return { error: 'This password has appeared in a public data breach. Please choose a different password.' };
    }

    const newPasswordHash = await hashPassword(newPassword);
    await db.transaction(async (tx) => {
      const [changed] = await tx.update(users).set({
        passwordHash: newPasswordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(users.id, user.id), eq(users.sessionVersion, user.sessionVersion))).returning({ id: users.id });
      if (!changed) throw new Error('Your account changed. Sign in again.');
      await tx.execute(sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,reason)
        values(${user.id},'account.password.changed','user',${String(user.id)},'self-service')`);
      await tx.execute(sql`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
        values(${user.id},'password_changed',${user.email},${`password-changed:${user.id}:${user.sessionVersion + 1}`})
        on conflict (dedupe_key) where dedupe_key is not null do nothing`);
    });
    await consumeFreshStepUp();
    await clearSession();
    redirect('/sign-in?password=changed');
  }
);

const deleteAccountSchema = z.object({ password: passwordEntrySchema });

export const deleteAccount = validatedActionWithUser(
  deleteAccountSchema,
  async (data, _, user) => {
    if ((await requireFreshStepUp(user, 'change-security-settings', '/dashboard/security')).required) redirect('/mfa');
    const isPasswordValid = await comparePasswords(data.password, user.passwordHash);
    if (!isPasswordValid) return { error: 'Incorrect password. Account deletion failed.' };
    // deleteOwnAccount performs its own authenticated authorization lookup, so the canonical
    // current session must remain active until that mutation has successfully committed.
    await deleteOwnAccount();
    await revokeAllUserSessions(user.id, 'account-deleted');
    await forgetAllLoginDevices(user.id, 'account-deleted');
    await consumeFreshStepUp();
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
      await issueEmailVerification(user.id, data.email);
      await consumeFreshStepUp();
      return { name, success: 'Check the new address to verify your email change.' };
    }
    // The normalized identity is unchanged (only casing/whitespace may differ, or nothing did), so
    // this never needs step-up, a duplicate check, or verification -- but the display form the
    // member actually typed must still survive (AUTH-IDENTITY-003), or a pure casing correction
    // would report success while silently leaving the old display casing in place.
    await db.update(users).set({ emailDisplay: emailDisplayForm(data.email), name }).where(eq(users.id, user.id));
    return { name, success: 'Account updated successfully.' };
  }
);
