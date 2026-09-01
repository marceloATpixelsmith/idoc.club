'use server';

import { z } from 'zod';
import { passwordEntrySchema } from '@/lib/auth/password-policy';
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
import { prepareRecoveryCodes } from '@/lib/auth/mfa/recovery';
import { regenerateRecoveryCodesWithEvidence } from '@/lib/auth/mfa/recovery-regeneration';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { forgetAllLoginDevices, forgetCurrentLoginDevice } from '@/lib/auth/login-device-trust';
import { revokeOtherUserSessionsWithEvidence, revokeSession } from '@/lib/auth/session-registry';
import { mfaStore } from '@/lib/auth/mfa/store';
import { setPendingPrimaryAuth } from '@/lib/auth/mfa/pending-primary-auth';
import { beginWebAuthnRegistration, finishWebAuthnRegistration } from '@/lib/auth/mfa/webauthn';
import { webauthnStore } from '@/lib/auth/mfa/webauthn-store';
import { enqueueAuthSecurityNotification } from '@/lib/notifications/auth-security-events';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { mfaConfiguration } from '@/lib/runtime/configuration';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

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
  const current = await canonicalSession(user.id);
  if (sessionId === current.sessionId) return { error: 'Use the normal sign-out action to log out this browser.' };
  await revokeSession(sessionId, user.id, 'member-security-session-signout');
  await audit(user.id, 'security.session.logged_out', 'member-security-page');
  refreshSecurityPage();
  return { success: 'That session has been logged out.' };
});

export const logOutOtherSessions = validatedActionWithUser(emptySchema, async (_, __, user) => {
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
  await setPendingPrimaryAuth({ applicationId: MFA_APPLICATION_ID, factorId: factor.factorId, hasWebAuthn: false,
    method: 'password', returnTo: '/dashboard/security', sessionVersion: user.sessionVersion,
    stage: 'recovery-entry', subjectId: user.id, transactionId });
  redirect('/mfa');
});

export const regenerateRecoveryCodes = validatedActionWithUser(emptySchema, async (_, __, user) => {
  const role = await authoritativeMfaRole(user.id);
  if (role !== 'admin' && role !== 'super-admin') {
    return { error: 'Recovery-code management is not available for this account.' };
  }
  if ((await requireFreshStepUp(user, 'generate-recovery-codes', '/dashboard/security')).required) redirect('/mfa');
  const config = mfaConfiguration();
  const prepared = prepareRecoveryCodes({ applicationId: MFA_APPLICATION_ID,
    digestSecret: config.recoveryDigestKey, subjectId: String(user.id) });
  const result = await regenerateRecoveryCodesWithEvidence({ applicationId: MFA_APPLICATION_ID,
    generationId: prepared.generationId, nowMs: prepared.nowMs, records: prepared.records, userId: user.id });
  await consumeFreshStepUp();
  if (result !== 'regenerated') return { error: 'Recovery codes could not be regenerated.' };
  refreshSecurityPage();
  return { recoveryCodes: prepared.codes, success: 'New recovery codes generated. Save them now.' };
});

async function privilegedUser(user: { id: number }) {
  const role = await authoritativeMfaRole(user.id);
  if (role !== 'admin' && role !== 'super-admin') throw new Error('Passkey management is not available for this account.');
  return role;
}

type PasskeyRegistrationOptions = Awaited<ReturnType<typeof beginWebAuthnRegistration>>['options'];

export const beginPasskeyRegistration = validatedActionWithUser(emptySchema, async (_, __, user): Promise<{
  error?: string; ceremonyId?: string; options?: PasskeyRegistrationOptions;
}> => {
  await privilegedUser(user);
  if ((await requireFreshStepUp(user, 'change-mfa', '/dashboard/security')).required) redirect('/mfa');
  const factor = await mfaStore.getActiveTotp(String(user.id), MFA_APPLICATION_ID);
  if (!factor) return { error: 'Set up an authenticator app before adding a passkey.' };
  const existing = await webauthnStore.getActiveCredentials(String(user.id), MFA_APPLICATION_ID);
  const { ceremonyId, options } = await beginWebAuthnRegistration({ subjectId: String(user.id),
    applicationId: MFA_APPLICATION_ID, accountLabel: user.email, baseUrl: baseUrlForServer(),
    excludeCredentials: existing, store: webauthnStore });
  await consumeFreshStepUp();
  return { ceremonyId, options };
});

const finishPasskeySchema = z.object({ ceremonyId: z.string().uuid(), credentialJson: z.string().min(1).max(8192),
  deviceName: z.string().trim().max(100).optional() });

export const finishPasskeyRegistration = validatedActionWithUser(finishPasskeySchema, async ({ ceremonyId, credentialJson, deviceName }, _, user): Promise<{ error?: string; success?: string }> => {
  await privilegedUser(user);
  let response: RegistrationResponseJSON;
  try {
    const parsed: unknown = JSON.parse(credentialJson);
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { id?: unknown }).id !== 'string') {
      return { error: 'That passkey response was not understood.' };
    }
    response = parsed as RegistrationResponseJSON;
  } catch { return { error: 'That passkey response was not understood.' }; }
  const result = await finishWebAuthnRegistration({ subjectId: String(user.id), applicationId: MFA_APPLICATION_ID,
    ceremonyId, response, baseUrl: baseUrlForServer(), deviceName: deviceName?.trim() || null, store: webauthnStore });
  if (result.status === 'no-totp-fallback') return { error: 'Set up an authenticator app before adding a passkey.' };
  if (result.status !== 'created') return { error: 'That passkey could not be registered.' };
  await audit(user.id, 'auth.mfa.passkey.registered', 'passkey');
  await enqueueAuthSecurityNotification({ dedupeKey: `passkey-registered:${result.factorId}`,
    kind: 'passkey_registered', userId: user.id });
  refreshSecurityPage();
  return { success: 'Passkey added.' };
});

const removePasskeySchema = z.object({ credentialId: z.string().min(1).max(255) });

export const removePasskeyCredential = validatedActionWithUser(removePasskeySchema, async ({ credentialId }, _, user): Promise<{ error?: string; success?: string }> => {
  await privilegedUser(user);
  if ((await requireFreshStepUp(user, 'change-mfa', '/dashboard/security')).required) redirect('/mfa');
  const revoked = await webauthnStore.revokeCredential({ credentialId, subjectId: String(user.id),
    applicationId: MFA_APPLICATION_ID, reason: 'user_removed', nowMs: Date.now() });
  await consumeFreshStepUp();
  if (!revoked) return { error: 'That passkey could not be removed.' };
  await audit(user.id, 'auth.mfa.passkey.removed', 'passkey');
  await enqueueAuthSecurityNotification({ dedupeKey: `passkey-removed:${credentialId}:${Date.now()}`,
    kind: 'passkey_removed', userId: user.id });
  refreshSecurityPage();
  return { success: 'Passkey removed.' };
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
