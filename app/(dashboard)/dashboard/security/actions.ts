'use server';

import { z } from 'zod';
import { passwordEntrySchema, passwordSchema } from '@/lib/auth/password-policy';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import { clearSession, comparePasswords, getSession, hashPassword } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import {
  createImmediateGoogleUnlinkFreshEvidence,
  issueGoogleLinkFreshEvidence,
} from '@/lib/auth/google-identity-link-evidence';
import { unlinkGoogleIdentity } from '@/lib/auth/google-identity-linking';
import { checkPasswordBreached } from '@/lib/security/password-breach-check';
import { notifyWebmasterOfBreachedPasswordAttempt } from '@/lib/notifications/breached-password-alert';
import { consumeFreshStepUp, requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { prepareRecoveryCodes } from '@/lib/auth/mfa/recovery';
import { regenerateRecoveryCodesWithEvidence } from '@/lib/auth/mfa/recovery-regeneration';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { forgetAllLoginDevices, forgetCurrentLoginDevice } from '@/lib/auth/login-device-trust';
import { revokeOtherUserSessionsWithEvidence, revokeSession } from '@/lib/auth/session-registry';
import { mfaStore } from '@/lib/auth/mfa/store';
import { generatePendingCsrfNonce, setPendingPrimaryAuth } from '@/lib/auth/mfa/pending-primary-auth';
import { mfaConfiguration } from '@/lib/runtime/configuration';

const currentPasswordSchema = z.object({ currentPassword: passwordEntrySchema });
const emptySchema = z.object({});
const sessionSchema = z.object({ sessionId: z.string().uuid() });

async function canonicalSession(userId: number) {
  const session = await getSession();
  if (!session || session.user.id !== userId || session.sessionId.startsWith('legacy-')) {
    throw new Error('A current canonical session is required. Sign in again.');
  }
  return session;
}

async function audit(userId: number, action: string, reason: string) {
  await db.execute(sql`insert into idoc.audit_log (actor_id, action, entity_type, entity_id, reason)
    values (${userId}, ${action}, 'user', ${String(userId)}, ${reason})`);
}

function refreshSecurityPage() {
  revalidatePath('/dashboard/security');
}

export const logOutSession = validatedActionWithUser(sessionSchema, async ({ sessionId }, _, user) => {
  if ((await requireFreshStepUp(user, 'revoke-sessions', '/dashboard/security')).required) return { stepUpRequired: true };
  const current = await canonicalSession(user.id);
  if (sessionId === current.sessionId) return { error: 'Use the normal sign-out action to log out this browser.' };
  await revokeSession(sessionId, user.id, 'member-security-session-signout');
  await audit(user.id, 'security.session.logged_out', 'member-security-page');
  refreshSecurityPage();
  return { success: 'That session has been logged out.' };
}, { allowWithoutEntitlement: true });

export const logOutOtherSessions = validatedActionWithUser(emptySchema, async (_, __, user) => {
  if ((await requireFreshStepUp(user, 'revoke-sessions', '/dashboard/security')).required) return { stepUpRequired: true };
  const current = await canonicalSession(user.id);
  await revokeOtherUserSessionsWithEvidence({
    currentSessionId: current.sessionId,
    dedupeKey: `other-sessions:${user.id}:${randomUUID()}`,
    reason: 'member-security-other-sessions-signout',
    recipientEmail: user.email,
    userId: user.id,
  });
  refreshSecurityPage();
  return { success: 'Your other sessions have been logged out.' };
}, { allowWithoutEntitlement: true });

export const forgetThisDevice = validatedActionWithUser(emptySchema, async (_, __, user) => {
  if (await authoritativeMfaRole(user.id) !== 'member') return { error: 'Remembered login devices do not apply to privileged accounts.' };
  await forgetCurrentLoginDevice(user.id);
  await audit(user.id, 'security.login_device.forgotten', 'member-security-page');
  refreshSecurityPage();
  return { success: 'This device is no longer remembered.' };
});

export const forgetAllRememberedDevices = validatedActionWithUser(emptySchema, async (_, __, user) => {
  if (await authoritativeMfaRole(user.id) !== 'member') return { error: 'Remembered login devices do not apply to privileged accounts.' };
  await forgetAllLoginDevices(user.id);
  await audit(user.id, 'security.login_devices.all_forgotten', 'member-security-page');
  refreshSecurityPage();
  return { success: 'All remembered devices have been forgotten.' };
});

export const beginAuthenticatorReplacement = validatedActionWithUser(emptySchema, async (_, __, user) => {
  const role = await authoritativeMfaRole(user.id);
  if (role !== 'admin' && role !== 'super-admin') return { error: 'Authenticator management is not available for this account.' };
  const factor = await mfaStore.getActiveTotp(String(user.id), MFA_APPLICATION_ID);
  if (!factor) return { error: 'No configured authenticator was found.' };
  if ((await requireFreshStepUp(user, 'replace-authenticator', '/dashboard/security')).required) return { stepUpRequired: true };
  const transactionId = randomUUID();
  await setPendingPrimaryAuth({ applicationId: MFA_APPLICATION_ID, csrfNonce: generatePendingCsrfNonce(), factorId: factor.factorId,
    method: 'password', returnTo: '/dashboard/security', sessionVersion: user.sessionVersion,
    stage: 'recovery-entry', subjectId: user.id, transactionId });
  // Recovery is intentionally a constrained primary-auth continuation, never an authenticated
  // account session. Revoke the initiating session before any recovery code can be consumed.
  await clearSession();
  redirect('/mfa');
});

export const regenerateRecoveryCodes = validatedActionWithUser(emptySchema, async (_, __, user) => {
  const role = await authoritativeMfaRole(user.id);
  if (role !== 'admin' && role !== 'super-admin') {
    return { error: 'Recovery-code management is not available for this account.' };
  }
  if ((await requireFreshStepUp(user, 'generate-recovery-codes', '/dashboard/security')).required) return { stepUpRequired: true };
  const config = mfaConfiguration();
  const prepared = prepareRecoveryCodes({ applicationId: MFA_APPLICATION_ID,
    digestSecret: config.recoveryDigestKey, subjectId: String(user.id) });
  const result = await regenerateRecoveryCodesWithEvidence({ applicationId: MFA_APPLICATION_ID,
    expectedSessionVersion: user.sessionVersion, generationId: prepared.generationId, nowMs: prepared.nowMs,
    records: prepared.records, userId: user.id });
  await consumeFreshStepUp();
  if (result !== 'regenerated') return { error: 'Recovery codes could not be regenerated.' };
  refreshSecurityPage();
  return { recoveryCodes: prepared.codes, success: 'New recovery codes generated. Save them now.' };
});

export const beginGoogleIdentityLink = validatedActionWithUser(
  currentPasswordSchema,
  async ({ currentPassword }, _, user) => {
    if ((await requireFreshStepUp(user, 'change-security-settings', '/dashboard/security')).required) return { stepUpRequired: true };
    if (!(await comparePasswords(currentPassword, user.passwordHash))) {
      return { error: 'Current password is incorrect.' };
    }
    await issueGoogleLinkFreshEvidence(user.id);
    await consumeFreshStepUp();
    redirect('/api/auth/google/link/start');
  },
);

export const disconnectGoogleIdentity = validatedActionWithUser(
  currentPasswordSchema,
  async ({ currentPassword }, _, user) => {
    if ((await requireFreshStepUp(user, 'change-security-settings', '/dashboard/security')).required) return { stepUpRequired: true };
    if (!(await comparePasswords(currentPassword, user.passwordHash))) {
      return { error: 'Current password is incorrect.' };
    }
    const result = await unlinkGoogleIdentity({
      userId: String(user.id),
      freshEvidence: createImmediateGoogleUnlinkFreshEvidence(user.id),
    });
    if (result.status === 'unlinked') await consumeFreshStepUp();
    if (result.status === 'unlinked') return { success: 'Google account disconnected.' };
    if (result.status === 'not-linked') return { success: 'No Google account is connected.' };
    return { error: 'Add another sign-in method before disconnecting Google.' };
  },
);

const createPasswordSchema = z.object({ newPassword: passwordSchema });

// A Google-only account (google-account.ts: `passwordSetAt` stays null) has no real, known password
// to satisfy disconnectGoogleIdentity's currentPassword check -- that control deliberately requires
// an already-known password (see docs/21 AUTH-OAUTH-009), so a Google-only account cannot reach it at
// all. This is the "add another sign-in method" the two account.ts controls above already gesture
// at: it creates one. The password is saved first, before the Google identity is ever touched -- if
// the unlink step then fails, the member still walks away with a working password rather than a
// stranded account with neither credential usable.
export const createPasswordAndDisconnectGoogle = validatedActionWithUser(
  createPasswordSchema,
  async ({ newPassword }, _, user) => {
    if ((await requireFreshStepUp(user, 'change-security-settings', '/dashboard/security')).required) return { stepUpRequired: true };
    if (user.passwordSetAt) return { error: 'A password is already set for this account.' };
    if ((await checkPasswordBreached(newPassword)).breached) {
      await notifyWebmasterOfBreachedPasswordAttempt({ email: user.email, source: 'google-disconnect' });
      return { error: 'This password has appeared in a public data breach. Please choose a different password.' };
    }

    const newPasswordHash = await hashPassword(newPassword);
    const now = new Date();
    await db.transaction(async (tx) => {
      const [saved] = await tx.update(users).set({
        passwordHash: newPasswordHash,
        passwordSetAt: now,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: now,
      }).where(and(eq(users.id, user.id), eq(users.sessionVersion, user.sessionVersion))).returning({ id: users.id });
      if (!saved) throw new Error('Your account changed. Sign in again.');
      await tx.execute(sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,reason)
        values(${user.id},'account.password.created','user',${String(user.id)},'google-disconnect-password-creation')`);
      await tx.execute(sql`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
        values(${user.id},'password_changed',${user.email},${`password-created:${user.id}:${user.sessionVersion + 1}`})
        on conflict (dedupe_key) where dedupe_key is not null do nothing`);
    });

    const result = await unlinkGoogleIdentity({
      userId: String(user.id),
      freshEvidence: createImmediateGoogleUnlinkFreshEvidence(user.id),
    });
    // The sessionVersion bump above already signs out every device -- including this one --
    // regardless of how the unlink call below turns out, so this action always ends in a redirect
    // to sign back in, never an inline error: returning one instead would let the member retry from
    // a session this request has already invalidated, throwing 'User is not authenticated' out of
    // validatedActionWithUser on the retry rather than failing gracefully.
    await consumeFreshStepUp();
    await clearSession();
    if (result.status === 'unlinked' || result.status === 'not-linked') redirect('/sign-in?password=created');
    // Google stays connected; the member signs back in with the new password they just saved and
    // retries disconnecting from a fresh session.
    redirect('/sign-in?password=created&google=unlink-failed');
  },
);
