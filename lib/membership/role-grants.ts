import 'server-only';

import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { applicationRoles, auditLog, users } from '@/lib/db/schema';
import { requireAccountAccess } from './data-access';
import { requireAdministrator, requireSuperAdmin } from './authorization';
import { consumeFreshStepUp, requireFreshStepUp } from '@/lib/auth/mfa/step-up';

export class FreshStepUpRequiredError extends Error {
  constructor() {
    super('Fresh authenticator verification is required.');
    this.name = 'FreshStepUpRequiredError';
  }
}

// 'member' is a valid value in the application_roles_role_check constraint but is never actually
// granted anywhere in this codebase — vestigial. Only these two are real, grantable roles.
const GRANTABLE_ROLES = ['administrator', 'super_admin'] as const;

const reasonSchema = z.string().trim().min(1, 'A reason is required').max(1000);
const grantSchema = z.object({ reason: reasonSchema, role: z.enum(GRANTABLE_ROLES) });
const revokeSchema = z.object({ reason: reasonSchema, role: z.enum(GRANTABLE_ROLES) });

/** Viewable by any administrator, matching the audit-trail's viewing tier — not Super-Admin-gated. */
export async function listActiveRoles(userId: number) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return db.select({ grantedAt: applicationRoles.grantedAt, grantedBy: applicationRoles.grantedBy, id: applicationRoles.id, role: applicationRoles.role })
    .from(applicationRoles).where(and(eq(applicationRoles.userId, userId), isNull(applicationRoles.revokedAt)));
}

/** The first real production call site for requireSuperAdmin — role granting is Super-Admin-only (docs/01 §6). */
export async function grantApplicationRole(userId: number, untrustedInput: unknown) {
  const input = grantSchema.parse(untrustedInput);
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  if ((await requireFreshStepUp(actor, 'change-privileged-permissions', '/admin/members')).required) {
    throw new FreshStepUpRequiredError();
  }

  const result = await db.transaction(async (tx) => {
    // application_roles_active_unique is a partial unique index (userId, role) where revokedAt is
    // null — a soft-revoked prior grant doesn't block a fresh one, only an actively-held role does.
    const [inserted] = await tx.insert(applicationRoles).values({ grantedBy: actor.id, role: input.role, userId })
      .onConflictDoNothing({ target: [applicationRoles.userId, applicationRoles.role], where: sql`${applicationRoles.revokedAt} is null` })
      .returning();
    if (!inserted) throw new Error('This user already holds this role.');

    // A privilege grant must not take effect inside an already-issued lower-assurance session.
    // Incrementing the target account's server-owned sessionVersion invalidates every existing
    // signed session for that user. Their next login evaluates the new role under the current auth
    // policy (including privileged MFA once that retrofit slice is installed).
    const [updatedUser] = await tx.update(users).set({
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).returning({ id: users.id });
    if (!updatedUser) throw new Error('The target user does not exist.');

    await tx.insert(auditLog).values({
      action: 'admin.role.granted', actorId: actor.id,
      afterJson: { role: input.role }, beforeJson: null,
      entityId: String(userId), entityType: 'user', reason: input.reason,
    });
    return { grant: inserted };
  });
  await consumeFreshStepUp();
  return result;
}

/**
 * Revokes a role. For 'super_admin', locks every active super_admin row (not just the target
 * user's) before checking the count, so two concurrent revocations of two different Super Admins
 * can't both read "2 remain" and both proceed — the second waits for the first's lock, then
 * re-evaluates and correctly sees only 1 remaining. Protects the last Super Admin from removal by
 * anyone, not just self-removal — a strict superset of what was asked, and simpler to implement.
 */
export async function revokeApplicationRole(userId: number, untrustedInput: unknown) {
  const input = revokeSchema.parse(untrustedInput);
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  if ((await requireFreshStepUp(actor, 'change-privileged-permissions', '/admin/members')).required) {
    throw new FreshStepUpRequiredError();
  }

  const result = await db.transaction(async (tx) => {
    if (input.role === 'super_admin') {
      const activeSuperAdmins = await tx.select({ id: applicationRoles.id }).from(applicationRoles)
        .where(and(eq(applicationRoles.role, 'super_admin'), isNull(applicationRoles.revokedAt)))
        .for('update');
      if (activeSuperAdmins.length <= 1) throw new Error('Cannot remove the last Super Admin.');
    }
    const [revoked] = await tx.update(applicationRoles).set({ revokedAt: new Date() })
      .where(and(eq(applicationRoles.userId, userId), eq(applicationRoles.role, input.role), isNull(applicationRoles.revokedAt)))
      .returning();
    if (!revoked) throw new Error('This user does not actively hold this role.');

    // Revocation must promptly remove authority from sessions that were authenticated while the
    // target held the role. getUser() rejects any signed session whose version no longer matches
    // this server-owned account value.
    const [updatedUser] = await tx.update(users).set({
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).returning({ id: users.id });
    if (!updatedUser) throw new Error('The target user does not exist.');

    await tx.insert(auditLog).values({
      action: 'admin.role.revoked', actorId: actor.id,
      afterJson: null, beforeJson: { role: input.role },
      entityId: String(userId), entityType: 'user', reason: input.reason,
    });
    return { revoked };
  });
  await consumeFreshStepUp();
  return result;
}
