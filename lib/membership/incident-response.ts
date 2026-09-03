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
import { enqueueOperationalAlert } from '@/lib/notifications/operational-alert-outbox';
import { escapeHtml, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { taggedSubject } from '@/lib/notifications/alert-severity';

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

const FORCE_REVOKE_ACTION = 'admin.account.authority_force_revoked';

// AUTH-OPERATIONS-007: matches the established users_email_unique / users_normalized_email_unique
// race pattern in lib/membership/email-verification.ts. audit_log_force_revoke_incident_unique
// (migration 0034) is the actual idempotency guarantee -- a second transaction attempting to record
// the same (userId, incidentReference) pair raises this instead of silently duplicating the state
// transition; drizzle-orm wraps the driver's PostgresError in its own error with the original
// attached as `.cause`, rather than always exposing `code`/`constraint_name` on the outer object, so
// both are checked.
function isForceRevokeIncidentRaceViolation(error: unknown): boolean {
  return !!error && typeof error === 'object'
    && (error as { code?: unknown }).code === '23505'
    && (error as { constraint_name?: unknown }).constraint_name === 'audit_log_force_revoke_incident_unique';
}

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
 *
 * Truly idempotent on (userId, incidentReference), not merely non-erroring: a retried or
 * double-submitted call with the same pair never re-bumps sessionVersion, never re-revokes an
 * already-revoked factor, and never sends a second notification -- it is indistinguishable from the
 * first call having simply finished. audit_log_force_revoke_incident_unique (migration 0034) is what
 * actually enforces this under concurrency; the pre-check below is only a fast path that skips the
 * mutating transaction entirely for the common sequential-retry case.
 */
export async function forceRevokeAllAuthority(userId: number, untrustedInput: unknown) {
  const input = incidentInputSchema.parse(untrustedInput);
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  if (actor.id === userId) throw new Error('Use your own account-security tools to act on your own account.');

  const [existing] = await db.select({ id: auditLog.id }).from(auditLog).where(and(
    eq(auditLog.action, FORCE_REVOKE_ACTION),
    eq(auditLog.entityType, 'user'),
    eq(auditLog.entityId, String(userId)),
    sql`${auditLog.afterJson} ->> 'incidentReference' = ${input.incidentReference}`,
  )).limit(1);

  if (!existing) {
    try {
      await db.transaction(async (tx) => {
        const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
        if (!target) throw new Error('This user does not exist.');

        await tx.update(users).set({
          sessionVersion: sql`${users.sessionVersion} + 1`,
          updatedAt: new Date(),
        }).where(eq(users.id, userId));

        await tx.update(mfaFactors).set({
          lifecycleReason: `incident:${input.incidentReference}`, revokedAt: new Date(), status: 'revoked', updatedAt: new Date(),
        }).where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.applicationId, MFA_APPLICATION_ID), inArray(mfaFactors.status, REVOCABLE_FACTOR_STATUSES)));

        await tx.update(loginTrustedDevices).set({ revokeReason: `incident:${input.incidentReference}`, revokedAt: new Date() })
          .where(and(eq(loginTrustedDevices.userId, userId), eq(loginTrustedDevices.applicationId, MFA_APPLICATION_ID), isNull(loginTrustedDevices.revokedAt)));

        await tx.insert(auditLog).values({
          action: FORCE_REVOKE_ACTION, actorId: actor.id,
          afterJson: { incidentReference: input.incidentReference }, beforeJson: null,
          entityId: String(userId), entityType: 'user', reason: input.reason,
        });
      });
    } catch (error) {
      // Lost a race to a concurrent identical call: the other transaction already recorded this
      // exact (userId, incidentReference) pair and committed the state transition. Fall through to
      // the naturally idempotent completion steps below instead of surfacing this as a failure.
      if (!isForceRevokeIncidentRaceViolation(error) && !isForceRevokeIncidentRaceViolation((error as { cause?: unknown } | null)?.cause)) throw error;
    }
  }

  // Deliberately outside the transaction, matching suspendUserAccount's established pattern: these
  // are plain, naturally idempotent UPDATEs (and idempotent-by-dedupe-key enqueues) against other
  // tables, not part of the state transition's atomicity requirement -- always safe to re-run,
  // whether this call performed the state transition itself, found it already recorded, or lost a
  // concurrent race for it, so a retry after any partial failure always completes whatever was missed.
  await revokeAllUserSessions(userId, `incident:${input.incidentReference}`);
  await revokeLoginDeviceTrustForUser(userId, `incident:${input.incidentReference}`);
  await mfaStore.revokeRememberedDevices(String(userId), MFA_APPLICATION_ID, Date.now());
  await enqueueAuthSecurityNotification({
    dedupeKey: `authority-force-revoked:${userId}:${input.incidentReference}`,
    kind: 'authority_force_revoked',
    userId,
  });

  const html = renderTransactionalEmail({
    bodyHtml: `<p>A Super Admin force-revoked all standing authority (every session, every remembered/trusted device, and every MFA factor) for member <b>#${userId}</b>.</p>
<p>Incident reference: <b>${escapeHtml(input.incidentReference)}</b></p>
<p>Reason: ${escapeHtml(input.reason)}</p>
<p>This is a deliberate, audited operator action (see idoc.audit_log for the full record). No response is required unless this incident reference is unfamiliar to you.</p>`,
    footerNote: 'IDOC security monitoring.',
    heading: 'Member authority force-revoked',
  });
  await enqueueOperationalAlert({
    bodyHtml: html,
    dedupeKey: `incident-response-action-taken:${userId}:${input.incidentReference}`,
    kind: 'incident_response_action_taken',
    subject: taggedSubject('administrator.authority_force_revoked', `IDOC: member #${userId} authority force-revoked`),
  });
}
