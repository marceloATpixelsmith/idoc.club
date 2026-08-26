import 'server-only';

import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getSession, type SessionData } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { users, type User } from '@/lib/db/schema';
import { mfaConfiguration } from '@/lib/runtime/configuration';
import { sensitiveActionRequiresFreshStepUp } from './decision';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from './login';
import { mfaStore } from './store';
import type { MfaRole, SensitiveAction } from './types';

type StepUpUser = Pick<User, 'id' | 'sessionVersion'>;

const PENDING_COOKIE = 'idoc_pending_step_up';
const AUTHORITY_COOKIE = 'idoc_fresh_step_up';
const TTL_SECONDS = 5 * 60;
const ACTIONS: readonly SensitiveAction[] = ['change-email', 'change-password', 'change-mfa',
  'replace-authenticator', 'generate-recovery-codes', 'invite-privileged-user',
  'change-privileged-permissions', 'change-security-settings'];

type BoundEvidence = {
  action: SensitiveAction;
  applicationId: typeof MFA_APPLICATION_ID;
  factorId: string;
  role: MfaRole;
  sessionId: string;
  sessionVersion: number;
  subjectId: number;
};

export type PendingStepUp = BoundEvidence & { returnTo: string; transactionId: string };
type FreshStepUp = BoundEvidence & { method: 'totp'; transactionId: string };

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
  const token = (await cookies()).get(name)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, mfaConfiguration().continuationKey, { algorithms: ['HS256'] });
    if (payload.applicationId !== MFA_APPLICATION_ID || !ACTIONS.includes(payload.action as SensitiveAction) ||
      !Number.isSafeInteger(payload.subjectId) || !Number.isSafeInteger(payload.sessionVersion) ||
      typeof payload.factorId !== 'string' || typeof payload.sessionId !== 'string' ||
      !['member', 'admin', 'super-admin'].includes(String(payload.role))) return null;
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

/** Applies canonical policy and starts a persisted, purpose-bound challenge when freshness is absent. */
export async function requireFreshStepUp(actor: Pick<User, 'id'>, action: SensitiveAction, returnTo: string) {
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
  const hasFreshTotp = Boolean(fresh && fresh.method === 'totp' && typeof fresh.transactionId === 'string' &&
    factor?.factorId === fresh.factorId && matches(fresh, user, binding.session, binding.role, action));
  const freshnessRequired = sensitiveActionRequiresFreshStepUp({ configuredFactor, hasFreshPolicyFactor: false,
    hasFreshTotp, hasFreshWebAuthn: false });
  if (!freshnessRequired && !hasFreshTotp) return { required: false as const };

  if (hasFreshTotp && fresh && factor) {
    const claimed = await mfaStore.consumeStepUpAuthority({ applicationId: MFA_APPLICATION_ID,
      factorId: factor.factorId, nowMs: Date.now(), subjectId: String(user.id), transactionId: fresh.transactionId });
    (await cookies()).delete(AUTHORITY_COOKIE);
    if (claimed === 'consumed') return { required: false as const };
  }

  if (!factor) throw new Error('Authenticator verification is required. Use the approved account recovery path.');
  const transactionId = randomUUID();
  const nowMs = Date.now();
  await mfaStore.createChallenge({ applicationId: MFA_APPLICATION_ID, expiresAtMs: nowMs + TTL_SECONDS * 1000,
    maxAttempts: 5, nowMs, purpose: 'step-up', subjectId: String(user.id), transactionId });
  const pending: PendingStepUp = { action, applicationId: MFA_APPLICATION_ID, factorId: factor.factorId,
    returnTo: safeReturnTo(returnTo), role: binding.role, sessionId: binding.session.sessionId,
    sessionVersion: user.sessionVersion, subjectId: user.id, transactionId };
  (await cookies()).set(PENDING_COOKIE, await sign(pending), cookieOptions(TTL_SECONDS));
  return { required: true as const };
}

export async function getPendingStepUp() {
  const pending = await read<PendingStepUp>(PENDING_COOKIE);
  if (!pending || typeof pending.transactionId !== 'string' || typeof pending.returnTo !== 'string') return null;
  const [user] = await db.select().from(users).where(eq(users.id, pending.subjectId)).limit(1);
  if (!user || user.deletedAt || !['active', 'onboarding'].includes(user.accountState)) return null;
  const binding = await currentBinding(user);
  if (!binding || !matches(pending, user, binding.session, binding.role, pending.action)) return null;
  return { pending, user };
}

export async function grantFreshStepUp(pending: PendingStepUp) {
  const authority: FreshStepUp = { action: pending.action, applicationId: pending.applicationId,
    factorId: pending.factorId, method: 'totp', role: pending.role, sessionId: pending.sessionId,
    sessionVersion: pending.sessionVersion, subjectId: pending.subjectId, transactionId: pending.transactionId };
  const store = await cookies();
  store.set(AUTHORITY_COOKIE, await sign(authority), cookieOptions(TTL_SECONDS));
  store.delete(PENDING_COOKIE);
}

export async function consumeFreshStepUp() {
  (await cookies()).delete(AUTHORITY_COOKIE);
}

export async function clearStepUpEvidence() {
  const store = await cookies();
  store.delete(PENDING_COOKIE);
  store.delete(AUTHORITY_COOKIE);
}
