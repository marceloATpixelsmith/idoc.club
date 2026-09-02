import 'server-only';

import { z } from 'zod';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, loginTrustedDevices, mfaFactors, users } from '@/lib/db/schema';
import { requireAccountAccess } from './data-access';
import { requireSuperAdmin } from './authorization';
import { revokeAllUserSessions } from '@/lib/auth/session-registry';
import { revokeLoginDeviceTrustForUser } from '@/lib/auth/login-device-trust';
import { MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { mfaStore } from '@/lib/auth/mfa/store';
import { enqueueAuthSecurityNotification } from '@/lib/notifications/auth-security-events';

// AUTH-OPERATIONS-007: an operator-initiated "force-revoke all authority for user X" tool for
// incident response -- distinct from suspendUserAccount (account-suspension.ts), which blocks future
// sign-in but does not itself touch MFA enrollment or an already-cut-session/device pairing the way
// this does, and distinct from the self-service revokeAllUserSessions/forgetAllLoginDevices call
// sites in app/(login)/actions.ts, which only ever act on the caller's own account. Before this,
// there was no code path for an administrator to respond to a compromised *account* (as opposed to a
// compromised infrastructure credential) by cutting every live session, every remembered/trusted
// device, and every enrolled MFA factor for a specific user in one action, with an incident-
// correlated audit trail -- an operator would have had to improvise by calling several unrelated
// self-service primitives that were never designed to be driven from an admin context.

// Capped well under the narrowest column this reference (with its "incident:" prefix, 9 chars) gets
// stamped into: idoc.auth_sessions.revoke_reason is only varchar(80) -- the tightest of the three
// revocation tables this touches -- so 70 leaves headroom on every one of them, not just the widest.
const incidentInputSchema = z.object({
  incidentReference: z.string().trim().min(1, 'An incident reference is required').max(70),
  reason: z.string().trim().min(1, 'A reason is required').max(1000),
});

const REVOCABLE_FACTOR_STATUSES = ['pending', 'active', 'disabled'] as const;

/**
 * Immediately and durably revokes every form of standing authority a user holds: every session
 * (bumping sessionVersion so an already-signed cookie can never be replayed back in, matching
 * suspendUserAccount's mechanism), every remembered/trusted login device, and every MFA factor
 * (TOTP and WebAuthn alike -- both live in idoc.mfa_factors, see schema.ts). Unlike
 * suspendUserAccount, this deliberately does not change users.account_state: the account itself may
 * still be legitimate (a stolen laptop, a leaked session, a suspected credential compromise) and the
 * owner should be able to sign back in and re-enroll MFA once they've regained control, not be
 * locked out of the account entirely -- that stronger response is exactly what suspendUserAccount is
 * for, and remains a separate, deliberate operator decision.
 *
 * Super-Admin-only (not just Administrator): this is a materially more disruptive, harder-to-reverse
 * action than an ordinary account-lifecycle change -- it can force every legitimate device the user
 * owns to re-authenticate and re-enroll MFA from scratch -- so it is held to the same privilege tier
 * as revokeApplicationRole/grantApplicationRole, and an operator cannot use it against their own
 * account (a self-lockout an already-mid-incident operator could not undo without another
 * Super Admin). Matching grantApplicationRole/revokeApplicationRole's own established split: this
 * request-context-agnostic data layer checks only requireSuperAdmin; the live Server Action
 * (forceRevokeAllAuthorityForm in app/(dashboard)/admin/members/actions.ts) additionally requires and
 * consumes canonical fresh step-up (action 'force-revoke-authority') before ever calling this
 * function -- possession of an authenticated Super Admin session and its CSRF token alone is not
 * sufficient to reach it.
 */
export async function forceRevokeAllAuthority(userId: number, untrustedInput: unknown) {
  const input = incidentInputSchema.parse(untrustedInput);
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  if (actor.id === userId) throw new Error('Use your own account-security tools to act on your own account.');

  const { revokedAt } = await db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, updatedAt: users.updatedAt }).from(users)
      .where(eq(users.id, userId)).for('update');
    if (!target) throw new Error('This user does not exist.');

    const [updated] = await tx.update(users).set({
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).returning({ updatedAt: users.updatedAt });

    await tx.update(mfaFactors).set({
      lifecycleReason: `incident:${input.incidentReference}`, revokedAt: new Date(), status: 'revoked', updatedAt: new Date(),
    }).where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.applicationId, MFA_APPLICATION_ID), inArray(mfaFactors.status, REVOCABLE_FACTOR_STATUSES)));

    await tx.update(loginTrustedDevices).set({ revokeReason: `incident:${input.incidentReference}`, revokedAt: new Date() })
      .where(and(eq(loginTrustedDevices.userId, userId), eq(loginTrustedDevices.applicationId, MFA_APPLICATION_ID), isNull(loginTrustedDevices.revokedAt)));

    await tx.insert(auditLog).values({
      action: 'admin.account.authority_force_revoked', actorId: actor.id,
      afterJson: { incidentReference: input.incidentReference }, beforeJson: null,
      entityId: String(userId), entityType: 'user', reason: input.reason,
    });
    return { revokedAt: updated.updatedAt };
  });

  // Deliberately outside the transaction, matching suspendUserAccount's established pattern: these
  // are plain, naturally idempotent UPDATEs against other tables, not part of the state transition's
  // atomicity requirement -- a retry after a partial failure safely completes whatever was missed.
  await revokeAllUserSessions(userId, `incident:${input.incidentReference}`);
  await revokeLoginDeviceTrustForUser(userId, `incident:${input.incidentReference}`);
  await mfaStore.revokeRememberedDevices(String(userId), MFA_APPLICATION_ID, Date.now());
  await enqueueAuthSecurityNotification({
    dedupeKey: `authority-force-revoked:${userId}:${revokedAt.toISOString()}`,
    kind: 'authority_force_revoked',
    userId,
  });
}
