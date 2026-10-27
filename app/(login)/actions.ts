'use server';

import { dispatchQueuedEmailAfterResponse } from '@/lib/notifications/immediate-dispatch';
import { processAuthSecurityNotificationBatch } from '@/lib/notifications/auth-security-delivery';

import { communicationHoldTimestamp, memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, users } from '@/lib/db/schema';
import { clearSession, comparePasswords, hashPassword, passwordHashNeedsUpgrade, rawCanonicalSessionId, rawCanonicalUserId, setSession } from '@/lib/auth/session';
import { requireCsrfTokenOrPendingNonce, requireCsrfTokenValue } from '@/lib/security/csrf';
import { redirect } from 'next/navigation';
import { consumeReturnTo } from '@/lib/auth/return-to';
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
import { revokeAllUserSessions, revokeSessionWithSignOutAudit } from '@/lib/auth/session-registry';
import { requireMemberSecurityEmailProof } from '@/lib/auth/member-security-step-up';
import { consumeFreshStepUp, requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { checkPasswordBreached } from '@/lib/security/password-breach-check';
import { verifyLegacyPassword } from '@/lib/auth/legacy-wordpress-hash';
import { notifyWebmasterOfBreachedPasswordAttempt } from '@/lib/notifications/breached-password-alert';
import { setUiFlash } from '@/lib/ui/flash-state';
import { loadSessionGate } from '@/lib/membership/session-gate-loader';
import { paymentOnlyDestination } from '@/lib/membership/session-gate';
import { supportEmailForServer } from '@/lib/runtime/configuration';
import { recordUserActivity } from '@/lib/activity/user-activity';
import { recordTokenSubmitted } from '@/lib/activity/token-link-activity';

const signInSchema = z.object({
  email: z.string().email().min(3).max(255),
  // Login verifies the existing credential exactly as supplied. Creation policy belongs only on
  // password creation/change boundaries and must not strand a valid legacy credential.
  password: passwordEntrySchema
});

/** Canonical login ordering from pixelsmith-auth-reference contract 1.9.0:
 * email -> password -> authoritative email-verification gate -> MFA/risk -> session.
 * Migrated/imported status is not a public login branch. */
export const signIn = validatedAction(signInSchema, async (data, formData) => {
  const { password } = data;
  const email = normalizeEmail(data.email);
  const pending = await getPendingLogin();
  if (!pending || pending.stage !== 'password' || pending.email !== email) {
    return { error: 'Your sign-in session expired. Start again.', email };
  }
  await requireCsrfTokenOrPendingNonce(formData, await rawCanonicalSessionId(), await rawCanonicalUserId(), pending.csrfNonce);

  // Independent dual-bucket throttle on the credential comparison itself (distinct from the
  // Turnstile+rate-limited email-collection step that gates entry into this pending-login stage):
  // without this, holding one valid pending-login cookie let comparePasswords() be called an
  // unlimited number of times within its lifetime.
  if (!(await checkRateLimit('login_password', email, await requestOrigin()))) {
    return { error: 'Too many attempts. Please try again in a few minutes.', email };
  }

  const matchingUsers = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (matchingUsers.length === 0) return { error: 'Invalid email or password. Please try again.', email };

  let foundUser = matchingUsers[0];
  let isPasswordValid = await comparePasswords(password, foundUser.passwordHash);
  // A migrated member signs in once with their WordPress password (docs/03 section 11). Only a pending migrated account
  // that still holds an exported hash in a supported format is ever checked against it.
  let legacyHashChecked = false;
  if (!isPasswordValid && foundUser.accountState === 'migrated_pending' && foundUser.legacyPasswordHash && foundUser.legacyPasswordFormat) {
    isPasswordValid = await verifyLegacyPassword(password, foundUser.legacyPasswordHash, foundUser.legacyPasswordFormat);
    legacyHashChecked = isPasswordValid;
  }

  if (!isPasswordValid || !['active', 'onboarding', 'migrated_pending'].includes(foundUser.accountState)) {
    // Recorded for the administrator Member timeline only; the response below is identical for every failure.
    await recordUserActivity(foundUser.id, 'sign_in_password_failed', { detail: { reason: isPasswordValid ? 'account_not_eligible' : 'wrong_password' } });
    return { error: 'Invalid email or password. Please try again.', email };
  }

  // The relationship ended: a membership canceled by the member or an administrator works through
  // its paid-through date, after which the account can no longer sign in. Checked only after the
  // password is verified, so this never reveals anything to someone who does not hold the credential.
  const sessionGate = await loadSessionGate(foundUser.id);
  if (sessionGate.gate === 'ended') {
    return { error: `This membership has been canceled, so signing in is no longer available. Contact ${supportEmailForServer()} if you believe this is a mistake.`, email };
  }

  if (legacyHashChecked && foundUser.legacyPasswordHash) {
    const breach = await checkPasswordBreached(password);
    // A verified legacy password may be used for identification, but it may only be
    // retained if it satisfies the current creation policy and is not known breached.
    // Require the existing email-verified activation/reset flow before any password
    // hash upgrade, account activation, MFA, or normal authenticated session.
    const legacyPasswordMeetsPolicy = passwordSchema.safeParse(password).success;
    if (breach.breached || !legacyPasswordMeetsPolicy) {
      await requestAccountLink(email, 'migration_activation', await requestOrigin());
      return {
        error: breach.breached
          ? 'That password appears in a known data breach and must be replaced. If this email has an account, we have sent a link to choose a new password.'
          : 'Your previous password does not meet the new IDOC password requirements. If this email has an account, we have sent a link to choose a new password.',
        email,
      };
    }
    if (!breach.checked) {
      await db.insert(auditLog).values({ action: 'auth.legacy_password.breach_check_unavailable', actorId: foundUser.id, entityId: String(foundUser.id), entityType: 'user' });
    }
    const now = new Date();
    const upgraded = await hashPassword(password);
    // Replace the exported hash with a current hash atomically; the old hash is cleared in the same statement that saves the new one,
    // and only if nobody else upgraded it first.
    const [claimed] = await db.update(users)
      .set({ passwordHash: upgraded, passwordSetAt: now, legacyPasswordHash: null, legacyPasswordFormat: null, updatedAt: now })
      .where(and(eq(users.id, foundUser.id), eq(users.legacyPasswordHash, foundUser.legacyPasswordHash)))
      .returning({ id: users.id });
    if (claimed) {
      foundUser = { ...foundUser, passwordHash: upgraded, passwordSetAt: now, legacyPasswordHash: null, legacyPasswordFormat: null };
    } else {
      const [current] = await db.select().from(users).where(eq(users.id, foundUser.id)).limit(1);
      if (!current || !(await comparePasswords(password, current.passwordHash))) return { error: 'Invalid email or password. Please try again.', email };
      foundUser = current;
    }
  }

  if (passwordHashNeedsUpgrade(foundUser.passwordHash)) {
    const upgradedHash = await hashPassword(password);
    await db.update(users)
      .set({ passwordHash: upgradedHash, updatedAt: new Date() })
      .where(and(eq(users.id, foundUser.id), eq(users.passwordHash, foundUser.passwordHash)));
  }

  const role = await authoritativeMfaRole(foundUser.id);
  // An account that hasn't finished onboarding still needs the wizard, not the homepage -- only a
  // fully set-up account gets the "login lands on the homepage" destination.
  // A member who has not paid (or whose membership lapsed) sees only the payment page, so that is
  // where sign-in lands them rather than the homepage they would be redirected away from.
  const loginDestination = sessionGate.gate === 'payment_only'
    ? paymentOnlyDestination(foundUser.accountState)
    : foundUser.accountState === 'onboarding' ? '/dashboard' : '/';

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
      role === 'member' && foundUser.accountState !== 'migrated_pending', pending.csrfNonce);
    redirect('/sign-in');
  }

  if (foundUser.accountState === 'migrated_pending') {
    const origin = await requestOrigin();
    const issued = await issueEmailOtp(email, 'login_verification', { origin, userId: foundUser.id });
    if (issued.status === 'delivery_failed') return { error: 'We could not send the verification code. Please try again.', email };
    if (issued.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.', email };
    await requireLoginOtp(email, foundUser.id, foundUser.sessionVersion, false, pending.csrfNonce);
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
        redirect(await consumeReturnTo(loginDestination, { honor: sessionGate.gate !== 'payment_only' }));
      }
      const [currentUser] = await db.select().from(users).where(and(
        eq(users.id, foundUser.id),
        eq(users.email, foundUser.email),
      )).limit(1);
      if (!currentUser || currentUser.deletedAt || !['active', 'onboarding'].includes(currentUser.accountState)) {
        await clearPendingLogin();
        return { error: 'Your sign-in session expired. Start again.', email };
      }
      if (await beginPrimaryMfa(currentUser, 'password', currentUser.accountState === 'onboarding' ? '/dashboard' : '/')) {
        await clearPendingLogin();
        redirect('/mfa');
      }
      return { error: 'Your sign-in session expired. Start again.', email };
    }
    const origin = await requestOrigin();
    const issued = await issueEmailOtp(email, 'login_verification', { origin, userId: foundUser.id });
    if (issued.status === 'delivery_failed') return { error: 'We could not send the verification code. Please try again.', email };
    if (issued.status === 'rate_limited') return { error: 'Too many attempts. Please try again in a few minutes.', email };
    await requireLoginOtp(email, foundUser.id, foundUser.sessionVersion, true, pending.csrfNonce);
    redirect('/sign-in');
  }

  if (await beginPrimaryMfa(foundUser, 'password', loginDestination)) {
    await clearPendingLogin();
    redirect('/mfa');
  }
  await clearPendingLogin();
  await setSession(foundUser);
  redirect(await consumeReturnTo(loginDestination, { honor: sessionGate.gate !== 'payment_only' }));
}, { skipCsrf: true });

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
  await recordTokenSubmitted(token, 'password_reset', result.status);
  if (result.status !== 'success') return result.status === 'breached_password' ? breachedPasswordError : { error: 'This reset link is invalid or expired.' };
  return finishTokenPasswordFlow('password-reset-success');
});

export const activateMigratedAccount = validatedAction(consumeTokenSchema, async ({ password, token }) => {
  const result = await consumeAccountToken(token, 'migration_activation', password);
  await recordTokenSubmitted(token, 'migration_activation', result.status);
  if (result.status !== 'success') return result.status === 'breached_password' ? breachedPasswordError : { error: 'This activation link is invalid or expired.' };
  return finishTokenPasswordFlow('account-activated');
});

// A successful token flow sends the member straight to the login page instead of leaving the
// spent password form on screen. Any pending login from the attempt that triggered the emailed
// link is dropped so /sign-in opens on the email step, where the flash notice is shown.
async function finishTokenPasswordFlow(flash: 'account-activated' | 'password-reset-success'): Promise<never> {
  await clearPendingLogin();
  await setUiFlash(flash, '/sign-in');
  redirect('/sign-in');
}

export async function signOut(csrfToken: string) {
  // AUTH-CSRF-001 explicitly includes logout among mutations requiring CSRF validation, even
  // though signing out an already-forged session mainly harms the attacker's own forged state --
  // it is still cookie-authenticated, state-changing, and invoked directly (not via a <form>), so it
  // is checked the same way as every other JS-invoked Server Action.
  // Captured before clearSession() clears the session cookie -- rawCanonicalUserId() and
  // rawCanonicalSessionId() would have nothing left to read from afterward.
  const userId = await rawCanonicalUserId();
  const sessionId = await rawCanonicalSessionId();
  await requireCsrfTokenValue(csrfToken, sessionId, userId);
  // Revoke and audit together, before touching browser state -- the same revoke-before-cookie-clear
  // ordering clearSession() itself already follows (see its own comment), just made atomic with the
  // audit evidence too. clearSession()'s own internal revokeSession() call becomes a harmless,
  // coalesce-idempotent no-op against the row this one already revoked.
  if (userId && sessionId) await revokeSessionWithSignOutAudit(sessionId, userId);
  await clearSession();
}

const updatePasswordSchema = z.object({
  currentPassword: passwordEntrySchema,
  newPassword: passwordSchema,
  memberSecurityCode: z.string().optional(),
});

export const updatePassword = validatedActionWithUser(
  updatePasswordSchema,
  async (data, _, user) => {
    const { currentPassword, newPassword, memberSecurityCode } = data;
    const member = await authoritativeMfaRole(user.id) === 'member';
    if (!member && (await requireFreshStepUp(user, 'change-password', '/dashboard/security')).required) return { stepUpRequired: true };

    const isPasswordValid = await comparePasswords(currentPassword, user.passwordHash);
    if (!isPasswordValid) return { error: 'Current password is incorrect.' };
    if (currentPassword === newPassword) return { error: 'New password must be different from the current password.' };
    if ((await checkPasswordBreached(newPassword)).breached) {
      await notifyWebmasterOfBreachedPasswordAttempt({ email: user.email, source: 'password-change' });
      return { error: 'This password has appeared in a public data breach. Please choose a different password.' };
    }

    if (member) {
      const evidence = await requireMemberSecurityEmailProof(user, 'member_password_change', memberSecurityCode);
      if (!evidence.approved) return evidence;
    }
    const newPasswordHash = await hashPassword(newPassword);
    await db.transaction(async (tx) => {
      const [changed] = await tx.update(users).set({
        passwordHash: newPasswordHash,
        passwordSetAt: new Date(),
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(users.id, user.id), eq(users.sessionVersion, user.sessionVersion))).returning({ id: users.id });
      if (!changed) throw new Error('Your account changed. Sign in again.');
      await tx.execute(sql`insert into audit_log(actor_id,action,entity_type,entity_id,reason)
        values(${user.id},'account.password.changed','user',${String(user.id)},'self-service')`);
      await tx.execute(sql`insert into auth_security_notification_outbox(dead_lettered_at,last_error_code,user_id,kind,recipient_email,dedupe_key)
        values(${communicationHoldTimestamp()}::timestamptz,case when ${memberCommunicationsDisabled()} then 'member_launch_hold' else null end,${user.id},'password_changed',${user.email},${`password-changed:${user.id}:${user.sessionVersion + 1}`})
        on conflict (dedupe_key) where dedupe_key is not null do nothing`);
    });
  dispatchQueuedEmailAfterResponse(() => processAuthSecurityNotificationBatch(1), 'account-delivery');
    await consumeFreshStepUp();
    await clearSession();
    await setUiFlash('password-changed', '/sign-in');
    redirect('/sign-in');
  }
);

const deleteAccountSchema = z.object({ password: passwordEntrySchema });

export const deleteAccount = validatedActionWithUser(
  deleteAccountSchema,
  async (data, _, user) => {
    if ((await requireFreshStepUp(user, 'change-security-settings', '/dashboard/security')).required) return { stepUpRequired: true };
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
  email: z.string().email('Invalid email address'),
  // Only read when the login email actually changes (My Profile always submits the field, empty when untouched).
  currentPassword: z.string().max(200).optional(),
});

// A 'use server' file may only export async functions, so this can't be exported for a composing
// caller (e.g. My Profile's combined save action, app/(dashboard)/account/actions.ts) to import --
// that file keeps its own copy of this exact string, which must stay in sync with it.
const EMAIL_VERIFICATION_PENDING_MESSAGE = 'Check the new address to verify your email change.';

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user) => {
    const email = normalizeEmail(data.email);
    if (email !== user.email) {
      if ((await requireFreshStepUp(user, 'change-email', '/dashboard/account')).required) return { stepUpRequired: true };
      // The login email is the recovery address for the password-reset and sign-in codes, so changing it hands over the whole account.
      // A session alone is not enough proof: members have no authenticator, so the step-up above is a no-op for them. The current
      // password is checked before anything else (including the duplicate check, which would otherwise tell a session holder which
      // addresses are taken). An account with no password (Google-only) must set one first.
      if (!user.passwordSetAt) return { error: 'Set a password under Security before changing your login email, or contact support.' };
      if (!data.currentPassword) return { error: 'Enter your current password to change your login email.' };
      if (!(await comparePasswords(data.currentPassword, user.passwordHash))) return { error: 'Current password is incorrect.' };
      const [duplicate] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (duplicate) return { error: 'That email address is unavailable.' };
      await issueEmailVerification(user.id, data.email);
      await consumeFreshStepUp();
      return { success: EMAIL_VERIFICATION_PENDING_MESSAGE };
    }
    // The normalized identity is unchanged (only casing/whitespace may differ, or nothing did), so
    // this never needs step-up, a duplicate check, or verification -- but the display form the
    // member actually typed must still survive (AUTH-IDENTITY-003), or a pure casing correction
    // would report success while silently leaving the old display casing in place.
    await db.update(users).set({ emailDisplay: emailDisplayForm(data.email) }).where(eq(users.id, user.id));
    return { success: 'Account updated successfully.' };
  }
);
