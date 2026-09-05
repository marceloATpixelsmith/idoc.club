'use server';

import { eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { validatedAction } from '@/lib/auth/middleware';
import { clearPendingLogin } from '@/lib/auth/pending-login';
import { clearSession, getSession, rawCanonicalSessionId, setSession } from '@/lib/auth/session';
import { requireCsrfTokenValue } from '@/lib/security/csrf';
import { users } from '@/lib/db/schema';
import { db } from '@/lib/db/drizzle';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';
import { mfaConfiguration } from '@/lib/runtime/configuration';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { clearPendingPrimaryAuth, getPendingPrimaryAuth, setPendingPrimaryAuth } from '@/lib/auth/mfa/pending-primary-auth';
import { digestRecoveryCode, prepareRecoveryCodes } from '@/lib/auth/mfa/recovery';
import { consumeRecoveryCodeAndBeginReplacement } from '@/lib/auth/mfa/recovery-security';
import { finalizeAuthenticatorReplacement } from '@/lib/auth/mfa/replacement-finalization';
import { finalizeInitialAuthenticatorEnrollment } from '@/lib/auth/mfa/enrollment-finalization';
import { mfaStore } from '@/lib/auth/mfa/store';
import { CompromisedMfaKeyError, beginTotpEnrollment, decryptTotpSecret, prepareTotpEnrollment, resolveMfaEncryptionKey, verifyActiveTotp, verifyTotpCode } from '@/lib/auth/mfa/totp';
import { auditCompromisedMfaKeyRejection } from '@/lib/auth/mfa/compromised-key-audit';
import { getPendingStepUp, grantFreshStepUp } from '@/lib/auth/mfa/step-up';
import { beginWebAuthnAuthentication, finishWebAuthnAuthentication } from '@/lib/auth/mfa/webauthn';
import { webauthnStore } from '@/lib/auth/mfa/webauthn-store';
import { enqueueAuthSecurityNotification } from '@/lib/notifications/auth-security-events';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { issueRememberedDevice } from '@/lib/auth/mfa/remembered-device';
import { logError } from '@/lib/observability/logger';
import { setRememberedTotpDeviceCookie } from '@/lib/auth/mfa/remembered-device-cookie';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') });
const loginCodeSchema = codeSchema.extend({ remember: z.string().optional() });
const webAuthnResponseSchema = z.object({ ceremonyId: z.string().uuid(), credentialJson: z.string().min(1).max(8192) });

function parseWebAuthnResponse(credentialJson: string): AuthenticationResponseJSON | null {
  try {
    const parsed: unknown = JSON.parse(credentialJson);
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { id?: unknown }).id !== 'string') return null;
    return parsed as AuthenticationResponseJSON;
  } catch { return null; }
}

export const verifyStepUpTotp = validatedAction(codeSchema, async ({ code }) => {
  const context = await getPendingStepUp();
  if (!context) return { error: 'Your verification session expired. Try the action again.' };
  if (!(await allowed(context.user.id, 'mfa_step_up_verify'))) return { error: 'Too many attempts. Try again later.' };
  const config = mfaConfiguration();
  let result;
  try {
    result = await verifyActiveTotp({ applicationId: MFA_APPLICATION_ID, code, purpose: 'step-up',
      resolveKey: (keyId) => resolveMfaEncryptionKey(config, keyId),
      store: mfaStore, subjectId: String(context.user.id), transactionId: context.pending.transactionId });
  } catch (error) {
    if (!(error instanceof CompromisedMfaKeyError)) throw error;
    await auditCompromisedMfaKeyRejection(String(context.user.id), error.keyId);
    return { error: 'This authenticator can no longer be used. Contact support to replace it.' };
  }
  if (result.status === 'invalid-code') return { error: 'That authenticator code is incorrect.' };
  if (result.status !== 'accepted') return { error: result.status === 'attempts-exhausted'
    ? 'Too many incorrect codes. Try the action again.' : 'Your verification session expired. Try the action again.' };
  await grantFreshStepUp(context.pending, { factorId: context.pending.factorId, method: 'totp' });
  redirect(context.pending.returnTo);
});

export async function beginStepUpWebAuthn(csrfToken: string) {
  await requireCsrfTokenValue(csrfToken, await rawCanonicalSessionId());
  const context = await getPendingStepUp();
  if (!context || !context.hasWebAuthn) throw new Error('A passkey is not available for this verification.');
  const credentials = await webauthnStore.getActiveCredentials(String(context.user.id), MFA_APPLICATION_ID);
  const { ceremonyId, options } = await beginWebAuthnAuthentication({ subjectId: String(context.user.id),
    applicationId: MFA_APPLICATION_ID, baseUrl: baseUrlForServer(), allowCredentials: credentials, store: webauthnStore });
  return { ceremonyId, options };
}

export const verifyStepUpWebAuthn = validatedAction(webAuthnResponseSchema, async ({ ceremonyId, credentialJson }) => {
  const context = await getPendingStepUp();
  if (!context || !context.hasWebAuthn) return { error: 'Your verification session expired. Try the action again.' };
  if (!(await allowed(context.user.id, 'mfa_step_up_verify'))) return { error: 'Too many attempts. Try again later.' };
  const response = parseWebAuthnResponse(credentialJson);
  if (!response) return { error: 'That passkey response was not understood.' };
  const verification = await finishWebAuthnAuthentication({ subjectId: String(context.user.id),
    applicationId: MFA_APPLICATION_ID, ceremonyId, response, baseUrl: baseUrlForServer(), store: webauthnStore });
  if (verification.status !== 'verified') return { error: 'That passkey could not be verified.' };
  const accepted = await mfaStore.acceptChallengeWithVerifiedFactor({ applicationId: MFA_APPLICATION_ID,
    factorId: verification.factorId, nowMs: Date.now(), purpose: 'step-up', subjectId: String(context.user.id),
    transactionId: context.pending.transactionId });
  if (accepted !== 'accepted') return { error: 'Your verification session expired. Try the action again.' };
  await grantFreshStepUp(context.pending, { factorId: verification.factorId, method: 'webauthn' });
  redirect(context.pending.returnTo);
});

async function pendingAccount(expected: 'challenge' | 'enrollment' | 'recovery-entry' | 'replacement' | 'recovery-ack') {
  const pending = await getPendingPrimaryAuth();
  if (!pending || pending.stage !== expected || pending.applicationId !== MFA_APPLICATION_ID) return null;
  const surroundingSession = await getSession();
  if (surroundingSession && surroundingSession.user.id !== pending.subjectId) return null;
  const [user] = await db.select().from(users).where(eq(users.id, pending.subjectId)).limit(1);
  if (!user || !['active', 'onboarding'].includes(user.accountState) || !user.emailVerifiedAt || user.deletedAt ||
    user.sessionVersion !== pending.sessionVersion) return null;
  const role = await authoritativeMfaRole(user.id);
  if (role !== 'admin' && role !== 'super-admin') return null;
  return { pending, user };
}

async function allowed(userId: number, purpose: string) {
  return checkRateLimit(purpose, String(userId), await requestOrigin());
}

async function failAndRestart(message: string) {
  await clearPendingPrimaryAuth();
  await clearPendingLogin();
  return { error: message };
}

export const verifyLoginTotp = validatedAction(loginCodeSchema, async ({ code, remember }) => {
  const context = await pendingAccount('challenge');
  if (!context) return failAndRestart('Your verification session expired. Sign in again.');
  if (!(await allowed(context.user.id, 'mfa_login_verify'))) return { error: 'Too many attempts. Sign in again later.' };
  const config = mfaConfiguration();
  let result;
  try {
    result = await verifyActiveTotp({ applicationId: MFA_APPLICATION_ID, code, purpose: 'login',
      resolveKey: (keyId) => resolveMfaEncryptionKey(config, keyId),
      store: mfaStore, subjectId: String(context.user.id), transactionId: context.pending.transactionId });
  } catch (error) {
    if (!(error instanceof CompromisedMfaKeyError)) throw error;
    await auditCompromisedMfaKeyRejection(String(context.user.id), error.keyId);
    return failAndRestart('This authenticator can no longer be used. Contact support to replace it.');
  }
  if (result.status === 'invalid-code') return { error: 'That authenticator code is incorrect.' };
  if (result.status === 'replay') {
    // A previously-accepted TOTP counter was resubmitted -- a cloned/replayed code, not an ordinary
    // mistake. Notify the account owner via a dedicated security event; the caller-facing response
    // stays the same generic "session expired" message so an attacker learns nothing extra.
    await enqueueAuthSecurityNotification({ dedupeKey: `mfa-replay:totp:${context.pending.transactionId}`,
      kind: 'mfa_replay_detected', userId: context.user.id });
    return failAndRestart('Your verification session expired. Sign in again.');
  }
  if (result.status !== 'accepted') return failAndRestart(result.status === 'attempts-exhausted'
    ? 'Too many incorrect codes. Sign in again.' : 'Your verification session expired. Sign in again.');
  // AUTH-REMEMBER-001: only ever offered when the policy is on, and only ever bound to the factor
  // that was just used to pass this exact challenge -- store.ts's revokeFactor/replacement paths
  // already revoke any remembered device tied to a factor once that factor stops being active.
  if (remember === 'on' && config.rememberedDevice.enabled && config.rememberedDevice.digestSecret) {
    const issued = await issueRememberedDevice({ applicationId: MFA_APPLICATION_ID,
      days: config.rememberedDevice.days, digestSecret: config.rememberedDevice.digestSecret,
      factorId: context.pending.factorId, store: mfaStore, subjectId: String(context.user.id) });
    await setRememberedTotpDeviceCookie(issued.token, issued.expiresAtMs, config.rememberedDevice.days);
  }
  await clearPendingPrimaryAuth();
  await clearPendingLogin();
  await setSession(context.user);
  redirect(context.pending.returnTo);
});

export async function beginLoginWebAuthn(csrfToken: string) {
  await requireCsrfTokenValue(csrfToken, await rawCanonicalSessionId());
  const context = await pendingAccount('challenge');
  if (!context || !context.pending.hasWebAuthn) throw new Error('A passkey is not available for this sign-in.');
  const credentials = await webauthnStore.getActiveCredentials(String(context.user.id), MFA_APPLICATION_ID);
  const { ceremonyId, options } = await beginWebAuthnAuthentication({ subjectId: String(context.user.id),
    applicationId: MFA_APPLICATION_ID, baseUrl: baseUrlForServer(), allowCredentials: credentials, store: webauthnStore });
  return { ceremonyId, options };
}

export const verifyLoginWebAuthn = validatedAction(webAuthnResponseSchema, async ({ ceremonyId, credentialJson }) => {
  const context = await pendingAccount('challenge');
  if (!context || !context.pending.hasWebAuthn) return failAndRestart('Your verification session expired. Sign in again.');
  if (!(await allowed(context.user.id, 'mfa_login_verify'))) return { error: 'Too many attempts. Sign in again later.' };
  const response = parseWebAuthnResponse(credentialJson);
  if (!response) return { error: 'That passkey response was not understood.' };
  const verification = await finishWebAuthnAuthentication({ subjectId: String(context.user.id),
    applicationId: MFA_APPLICATION_ID, ceremonyId, response, baseUrl: baseUrlForServer(), store: webauthnStore });
  if (verification.status === 'replay') {
    // A non-increasing signature counter -- the signature of a cloned authenticator or a replayed
    // response, not an ordinary failed verification. Notify the account owner via a dedicated
    // security event; the caller-facing response stays the same generic message either way.
    await enqueueAuthSecurityNotification({ dedupeKey: `mfa-replay:webauthn:${context.pending.transactionId}`,
      kind: 'mfa_replay_detected', userId: context.user.id });
    return { error: 'That passkey could not be verified.' };
  }
  if (verification.status !== 'verified') return { error: 'That passkey could not be verified.' };
  const accepted = await mfaStore.acceptChallengeWithVerifiedFactor({ applicationId: MFA_APPLICATION_ID,
    factorId: verification.factorId, nowMs: Date.now(), purpose: 'login', subjectId: String(context.user.id),
    transactionId: context.pending.transactionId });
  if (accepted !== 'accepted') return failAndRestart('Your verification session expired. Sign in again.');
  await clearPendingPrimaryAuth();
  await clearPendingLogin();
  await setSession(context.user);
  redirect(context.pending.returnTo);
});

// A rejected or rate-limited recovery-code attempt previously left no durable trace anywhere --
// only a thrown exception (mfa_recovery_transition_failed) was ever recorded, so an operator
// looking at real production failures (a rejected code, a rate-limited attempt) had nothing
// queryable to diagnose against. Never records the submitted code itself, only that an attempt for
// this account was rejected and why.
async function auditRecoveryCodeFailure(userId: number, reason: 'invalid_or_already_consumed_code' | 'rate_limited') {
  await db.execute(sql`insert into idoc.audit_log (actor_id, action, entity_type, entity_id, reason)
    values (${userId}, 'auth.mfa.recovery_code.rejected', 'user', ${String(userId)}, ${reason})`);
}

export const beginAuthenticatorRecovery = validatedAction(z.object({ recover: z.literal('yes') }), async () => {
  const context = await pendingAccount('challenge');
  if (!context) return failAndRestart('Your verification session expired. Sign in again.');
  await setPendingPrimaryAuth({ ...context.pending, stage: 'recovery-entry' });
  return { success: 'Enter one of your recovery codes.' };
});

export const authorizeAuthenticatorRecovery = validatedAction(z.object({ recoveryCode: z.string().trim().min(1).max(64) }), async ({ recoveryCode }) => {
  const context = await pendingAccount('recovery-entry');
  if (!context) return failAndRestart('Your recovery session expired. Sign in again.');
  if (!(await allowed(context.user.id, 'mfa_recovery_code_verify'))) {
    await auditRecoveryCodeFailure(context.user.id, 'rate_limited');
    return failAndRestart('Too many attempts. Sign in again later.');
  }
  const config = mfaConfiguration();
  const enrollment = prepareTotpEnrollment({ accountLabel: context.user.email, applicationId: MFA_APPLICATION_ID,
    encryptionKey: config.encryptionKeys.get(config.activeKeyId)!, issuer: 'IDOC', keyId: config.activeKeyId,
    purpose: 'authenticator-replacement', subjectId: String(context.user.id),
    transactionId: context.pending.transactionId });
  let recovery: { factorId?: string; status: 'invalid' | 'ready'; transactionId?: string };
  try {
    recovery = await consumeRecoveryCodeAndBeginReplacement({
      applicationId: MFA_APPLICATION_ID,
      dedupeKey: `recovery-code:${context.pending.transactionId}`,
      digests: [digestRecoveryCode(recoveryCode, config.recoveryDigestKey)],
      enrollment: enrollment.enrollment,
      factor: enrollment.factor,
      recipientEmail: context.user.email,
      userId: context.user.id,
    });
  } catch {
    await logError('mfa_recovery_transition_failed', { subjectId: context.user.id });
    return { error: 'Authenticator recovery could not be completed. Restart recovery and try again.' };
  }
  if (recovery.status !== 'ready' || !recovery.factorId || !recovery.transactionId) {
    await auditRecoveryCodeFailure(context.user.id, 'invalid_or_already_consumed_code');
    return { error: 'That recovery code could not be used.' };
  }
  await setPendingPrimaryAuth({ ...context.pending, factorId: recovery.factorId, stage: 'replacement',
    transactionId: recovery.transactionId });
  redirect('/mfa');
});

export const confirmTotpEnrollment = validatedAction(codeSchema, async ({ code }) => {
  const pending = await getPendingPrimaryAuth();
  const stage = pending?.stage === 'replacement' ? 'replacement' : 'enrollment';
  const context = await pendingAccount(stage);
  if (!context) return failAndRestart('Your setup session expired. Sign in again.');
  if (!(await allowed(context.user.id, 'mfa_enrollment_confirm'))) return { error: 'Too many attempts. Sign in again later.' };
  const config = mfaConfiguration();
  const resolveKey = (keyId: string) => resolveMfaEncryptionKey(config, keyId);
  const nowMs = Date.now();

  const enrollment = await mfaStore.getPendingTotpEnrollment({
    applicationId: MFA_APPLICATION_ID, factorId: context.pending.factorId, nowMs,
    subjectId: String(context.user.id), transactionId: context.pending.transactionId,
  });
  const expectedPurpose = stage === 'replacement' ? 'authenticator-replacement' : 'mfa-enrollment';
  if (!enrollment || enrollment.enrollment.purpose !== expectedPurpose || enrollment.factor.status !== 'pending' ||
    enrollment.enrollment.consumedAtMs !== null || enrollment.enrollment.expiresAtMs <= nowMs) {
    return failAndRestart('Your setup session expired. Sign in again.');
  }
  let acceptedCounter;
  try {
    acceptedCounter = verifyTotpCode(decryptTotpSecret(enrollment.factor.encryptedSecret, resolveKey), code, nowMs);
  } catch (error) {
    if (!(error instanceof CompromisedMfaKeyError)) throw error;
    await auditCompromisedMfaKeyRejection(String(context.user.id), error.keyId);
    return failAndRestart('This authenticator can no longer be used. Contact support to replace it.');
  }
  if (acceptedCounter === null) return { error: 'That authenticator code is incorrect.' };

  const recovery = prepareRecoveryCodes({ applicationId: MFA_APPLICATION_ID,
    digestSecret: config.recoveryDigestKey, nowMs, subjectId: String(context.user.id) });

  if (stage === 'replacement') {
    const nextSessionVersion = context.user.sessionVersion + 1;
    // Write the fail-closed continuation first. If the database transaction below rolls back,
    // this cookie cannot validate because the user's sessionVersion will still be the old value.
    await setPendingPrimaryAuth({ ...context.pending, sessionVersion: nextSessionVersion, stage: 'recovery-ack' });
    const result = await finalizeAuthenticatorReplacement({ acceptedCounter, applicationId: MFA_APPLICATION_ID,
      expectedSessionVersion: context.user.sessionVersion, factorId: context.pending.factorId, nowMs,
      recoveryCodes: recovery.records, recoveryGenerationId: recovery.generationId,
      transactionId: context.pending.transactionId, userId: context.user.id });
    if (result.status !== 'activated' || result.sessionVersion !== nextSessionVersion) {
      return failAndRestart('Your setup session expired. Sign in again.');
    }
    return { recoveryCodes: recovery.codes, success: 'Authenticator replaced. Save these new recovery codes now.' };
  }

  const result = await finalizeInitialAuthenticatorEnrollment({
    acceptedCounter,
    applicationId: MFA_APPLICATION_ID,
    factorId: context.pending.factorId,
    nowMs,
    recoveryCodes: recovery.records,
    recoveryGenerationId: recovery.generationId,
    transactionId: context.pending.transactionId,
    userId: context.user.id,
  });
  if (result.status !== 'activated') return failAndRestart('Your setup session expired. Sign in again.');
  await setPendingPrimaryAuth({ ...context.pending, stage: 'recovery-ack' });
  return { recoveryCodes: recovery.codes, success: 'Authenticator enabled. Save these recovery codes now.' };
});

export const acknowledgeRecoveryCodes = validatedAction(z.object({ saved: z.literal('yes') }), async () => {
  const context = await pendingAccount('recovery-ack');
  if (!context) return failAndRestart('Your setup session expired. Sign in again.');
  const activeFactor = await mfaStore.getActiveTotp(String(context.user.id), MFA_APPLICATION_ID);
  if (!activeFactor || activeFactor.factorId !== context.pending.factorId) return failAndRestart('Your setup session expired. Sign in again.');
  const acknowledgement = await mfaStore.consumeRecoveryAcknowledgement({
    applicationId: MFA_APPLICATION_ID,
    factorId: context.pending.factorId,
    nowMs: Date.now(),
    subjectId: String(context.user.id),
    transactionId: context.pending.transactionId,
  });
  if (acknowledgement !== 'consumed') return failAndRestart('Your setup session expired. Sign in again.');
  await clearPendingPrimaryAuth();
  await clearPendingLogin();
  await setSession(context.user);
  redirect(context.pending.returnTo);
});

export const cancelMfa = validatedAction(z.object({ cancel: z.literal('yes') }), async () => {
  await clearPendingPrimaryAuth();
  await clearPendingLogin();
  redirect('/sign-in');
});
