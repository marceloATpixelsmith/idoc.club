import 'server-only';

import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { requestCookies } from '@/lib/auth/request-cookies';
import { getSession, type SessionData } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { users, type User } from '@/lib/db/schema';
import { mfaConfiguration } from '@/lib/runtime/configuration';
import { sensitiveActionRequiresFreshStepUp } from './decision';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from './login';
import { mfaStore } from './store';
import { webauthnStore } from './webauthn-store';
import type { MfaRole, SensitiveAction } from './types';

type StepUpUser = Pick<User, 'id' | 'sessionVersion'>;

const PENDING_COOKIE = 'idoc_pending_step_up';
const AUTHORITY_COOKIE = 'idoc_fresh_step_up';
const TTL_SECONDS = 5 * 60;
const ACTIONS: readonly SensitiveAction[] = ['change-email', 'change-password', 'change-mfa',
  'replace-authenticator', 'generate-recovery-codes', 'invite-privileged-user',
  'change-privileged-permissions', 'change-security-settings', 'force-revoke-authority'];

type BoundEvidence = {
  action: SensitiveAction;
  applicationId: typeof MFA_APPLICATION_ID;
  factorId: string;
  role: MfaRole;
  sessionId: string;
  sessionVersion: number;
  subjectId: number;
};

// `resume` lets the step-up verification handler apply the member's original request itself the
// moment a fresh code is accepted, instead of only redirecting back to `returnTo` and leaving the
// member to resubmit the exact same request a second time (a real production report: every one of
// these actions previously required a code, then a second, separate submission of the same form to
// actually take effect). Only set for actions whose replay payload holds no secret (a role, a user
// id, a free-text reason, a display name/new email address -- never a password or other credential,
// which this cookie deliberately never carries even short-lived); the handful of actions that
// genuinely need a password (change-password, delete-account, Google link/unlink) keep the original
// one-more-submission behavior rather than caching a plaintext credential server-side to avoid it.
export type PendingStepUp = BoundEvidence & { resume?: { kind: string; payload: Record<string, string> }; returnTo: string; transactionId: string };
type FreshStepUp = BoundEvidence & { method: 'totp' | 'webauthn'; transactionId: string };

function cookieOptions(maxAge: number) {
  return { httpOnly: true, maxAge, path: '/', sameSite: 'lax' as const, secure: true };
}

function safeReturnTo(value: string) {
  return value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

async function sign(value: PendingStepUp | FreshStepUp) {
  return new SignJWT(value).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`).sign(mfaConfiguration().continuationKey);
}

async function read<T extends BoundEvidence>(name: string): Promise<T | null> {
  const token = (await requestCookies()).get(name)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, mfaConfiguration().continuationKey, { algorithms: ['HS256'] });
    if (payload.applicationId !== MFA_APPLICATION_ID || !ACTIONS.includes(payload.action as SensitiveAction) ||
      !Number.isSafeInteger(payload.subjectId) || !Number.isSafeInteger(payload.sessionVersion) ||
      typeof payload.factorId !== 'string' || typeof payload.sessionId !== 'string' ||
      !['member', 'admin', 'super-admin'].includes(String(payload.role))) return null;
    if (payload.resume !== undefined) {
      const resume = payload.resume as { kind?: unknown; payload?: unknown };
      if (typeof resume.kind !== 'string' || !resume.payload || typeof resume.payload !== 'object' ||
        Array.isArray(resume.payload) || Object.values(resume.payload).some((value) => typeof value !== 'string')) {
        return null;
      }
    }
    return payload as unknown as T;
  } catch {
    return null;
  }
}

async function currentBinding(user: StepUpUser) {
  const session = await getSession();
  if (!session || session.sessionId.startsWith('legacy-') || session.user.id !== user.id ||
    session.user.sessionVersion !== user.sessionVersion) return null;
  const role = await authoritativeMfaRole(user.id);
  return { role, session };
}

function matches(evidence: BoundEvidence, user: StepUpUser, session: SessionData, role: MfaRole, action: SensitiveAction) {
  return evidence.action === action && evidence.applicationId === MFA_APPLICATION_ID &&
    evidence.subjectId === user.id && evidence.sessionId === session.sessionId &&
    evidence.sessionVersion === user.sessionVersion && evidence.role === role;
}

/** Applies canonical policy and starts a persisted, purpose-bound challenge when freshness is absent.
 * `resume`, when given, is replayed automatically by the step-up verification handler the instant a
 * fresh code is accepted -- see `PendingStepUp`'s doc comment for why only non-secret payloads may
 * ever be passed here. */
export async function requireFreshStepUp(
  actor: Pick<User, 'id'>,
  action: SensitiveAction,
  returnTo: string,
  resume?: { kind: string; payload: Record<string, string> },
) {
  const [user] = await db.select().from(users).where(eq(users.id, actor.id)).limit(1);
  if (!user || user.deletedAt || !['active', 'onboarding'].includes(user.accountState)) {
    throw new Error('Your session is no longer valid. Sign in again.');
  }
  const binding = await currentBinding(user);
  if (!binding) throw new Error('Your session is no longer valid. Sign in again.');
  const configuredFactor = binding.role === 'admin' || binding.role === 'super-admin' ? 'totp' : 'none';
  const fresh = await read<FreshStepUp>(AUTHORITY_COOKIE);
  const factor = configuredFactor === 'totp'
    ? await mfaStore.getActiveTotp(String(user.id), MFA_APPLICATION_ID)
    : null;
  const webAuthnCredentials = configuredFactor === 'totp'
    ? await webauthnStore.getActiveCredentials(String(user.id), MFA_APPLICATION_ID)
    : [];
  const hasFreshTotp = Boolean(fresh && fresh.method === 'totp' && typeof fresh.transactionId === 'string' &&
    factor?.factorId === fresh.factorId && matches(fresh, user, binding.session, binding.role, action));
  const hasFreshWebAuthn = Boolean(fresh && fresh.method === 'webauthn' && typeof fresh.transactionId === 'string' &&
    webAuthnCredentials.some((credential) => credential.factorId === fresh.factorId) &&
    matches(fresh, user, binding.session, binding.role, action));
  // TOTP remains the policy-required factor for privileged step-up; a WebAuthn credential, when the
  // account has one, is an accepted alternate proof of that same requirement -- not a separate policy.
  const freshnessRequired = sensitiveActionRequiresFreshStepUp({ configuredFactor, hasFreshPolicyFactor: false,
    hasFreshTotp, hasFreshWebAuthn: false });
  if (!freshnessRequired && !hasFreshTotp && !hasFreshWebAuthn) return { required: false as const };

  if ((hasFreshTotp || hasFreshWebAuthn) && fresh) {
    const claimed = await mfaStore.consumeStepUpAuthority({ applicationId: MFA_APPLICATION_ID,
      factorId: fresh.factorId, nowMs: Date.now(), subjectId: String(user.id), transactionId: fresh.transactionId });
    (await requestCookies()).delete(AUTHORITY_COOKIE);
    if (claimed === 'consumed') return { required: false as const };
  }

  if (!factor) throw new Error('Authenticator verification is required. Use the approved account recovery path.');
  const transactionId = randomUUID();
  const nowMs = Date.now();
  await mfaStore.createChallenge({ applicationId: MFA_APPLICATION_ID, expiresAtMs: nowMs + TTL_SECONDS * 1000,
    maxAttempts: 5, nowMs, purpose: 'step-up', subjectId: String(user.id), transactionId });
  const pending: PendingStepUp = { action, applicationId: MFA_APPLICATION_ID, factorId: factor.factorId,
    resume, returnTo: safeReturnTo(returnTo), role: binding.role, sessionId: binding.session.sessionId,
    sessionVersion: user.sessionVersion, subjectId: user.id, transactionId };
  (await requestCookies()).set(PENDING_COOKIE, await sign(pending), cookieOptions(TTL_SECONDS));
  return { required: true as const };
}

export async function getPendingStepUp() {
  const pending = await read<PendingStepUp>(PENDING_COOKIE);
  if (!pending || typeof pending.transactionId !== 'string' || typeof pending.returnTo !== 'string') return null;
  const [user] = await db.select().from(users).where(eq(users.id, pending.subjectId)).limit(1);
  if (!user || user.deletedAt || !['active', 'onboarding'].includes(user.accountState)) return null;
  const binding = await currentBinding(user);
  if (!binding || !matches(pending, user, binding.session, binding.role, pending.action)) return null;
  const webAuthnCredentials = await webauthnStore.getActiveCredentials(String(user.id), MFA_APPLICATION_ID);
  return { pending, user, hasWebAuthn: webAuthnCredentials.length > 0 };
}

/** Grants fresh step-up authority proven via the given factor. `factorId`/`method` describe whichever
 * factor was actually just verified (TOTP or, when the account has one, WebAuthn) -- not necessarily
 * pending.factorId, which always names the TOTP factor the challenge was created against. */
export async function grantFreshStepUp(pending: PendingStepUp, evidence: { factorId: string; method: 'totp' | 'webauthn' }) {
  const authority: FreshStepUp = { action: pending.action, applicationId: pending.applicationId,
    factorId: evidence.factorId, method: evidence.method, role: pending.role, sessionId: pending.sessionId,
    sessionVersion: pending.sessionVersion, subjectId: pending.subjectId, transactionId: pending.transactionId };
  const store = await requestCookies();
  store.set(AUTHORITY_COOKIE, await sign(authority), cookieOptions(TTL_SECONDS));
  store.delete(PENDING_COOKIE);
}

export async function consumeFreshStepUp() {
  (await requestCookies()).delete(AUTHORITY_COOKIE);
}

export async function clearStepUpEvidence() {
  const store = await requestCookies();
  store.delete(PENDING_COOKIE);
  store.delete(AUTHORITY_COOKIE);
}
