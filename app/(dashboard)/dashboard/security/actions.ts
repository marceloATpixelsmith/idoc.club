'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import { comparePasswords, getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import {
  createImmediateGoogleUnlinkFreshEvidence,
  issueGoogleLinkFreshEvidence,
} from '@/lib/auth/google-identity-link-evidence';
import { unlinkGoogleIdentity } from '@/lib/auth/google-identity-linking';
import { consumeFreshStepUp, requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { forgetAllLoginDevices, forgetCurrentLoginDevice } from '@/lib/auth/login-device-trust';
import { revokeOtherUserSessions, revokeSession } from '@/lib/auth/session-registry';
import { mfaStore } from '@/lib/auth/mfa/store';
import { setPendingPrimaryAuth } from '@/lib/auth/mfa/pending-primary-auth';

const currentPasswordSchema = z.object({ currentPassword: z.string().min(1).max(128) });
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
  const current = await canonicalSession(user.id);
  if (sessionId === current.sessionId) return { error: 'Use the normal sign-out action to log out this browser.' };
  await revokeSession(sessionId, user.id, 'member-security-session-signout');
  await audit(user.id, 'security.session.logged_out', 'member-security-page');
  refreshSecurityPage();
  return { success: 'That session has been logged out.' };
});

export const logOutOtherSessions = validatedActionWithUser(emptySchema, async (_, __, user) => {
  const current = await canonicalSession(user.id);
  await revokeOtherUserSessions(user.id, current.sessionId, 'member-security-other-sessions-signout');
  await audit(user.id, 'security.sessions.others_logged_out', 'member-security-page');
  await db.execute(sql`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
    values(${user.id},'other_sessions_revoked',${user.email},${`other-sessions:${user.id}:${randomUUID()}`})`);
  refreshSecurityPage();
  return { success: 'Your other sessions have been logged out.' };
});

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
  const transactionId = randomUUID();
  await setPendingPrimaryAuth({ applicationId: MFA_APPLICATION_ID, factorId: factor.factorId, method: 'password',
    returnTo: '/dashboard/security', sessionVersion: user.sessionVersion, stage: 'recovery-entry', subjectId: user.id,
    transactionId });
  redirect('/mfa');
});

export const beginGoogleIdentityLink = validatedActionWithUser(
  currentPasswordSchema,
  async ({ currentPassword }, _, user) => {
    if ((await requireFreshStepUp(user, 'change-security-settings', '/dashboard/security')).required) redirect('/mfa');
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
    if ((await requireFreshStepUp(user, 'change-security-settings', '/dashboard/security')).required) redirect('/mfa');
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
