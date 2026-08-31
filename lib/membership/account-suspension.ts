import 'server-only';

import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { applicationRoles, auditLog, users } from '@/lib/db/schema';
import { requireAccountAccess } from './data-access';
import { requireAdministrator } from './authorization';
import { revokeAllUserSessions } from '@/lib/auth/session-registry';
import { revokeLoginDeviceTrustForUser } from '@/lib/auth/login-device-trust';
import { enqueueAuthSecurityNotification } from '@/lib/notifications/auth-security-events';

// This is the account-authentication suspension AUTH-LIFECYCLE-006 named as a real gap: distinct
// from suspendMembership in status-actions.ts, which freezes club-entitlement access but leaves a
// member able to sign in and manage their own account. This suspends the ability to authenticate
// at all -- for a compromised or abusive account, pending investigation -- by writing
// users.account_state = 'suspended', a state mayAccessAccountFunction (lib/membership/
// account-access.ts) already treats as a hard deny for every account-function boundary, and that
// signIn (app/(login)/actions.ts) already rejects outright. Nothing previously ever wrote this
// value; the enforcement existed with no way to trigger it.

const reasonSchema = z.string().trim().min(1, 'A reason is required').max(1000);
const SUSPENDABLE_STATES = ['active', 'onboarding', 'migrated_pending'] as const;
const REINSTATABLE_STATES = ['active', 'onboarding', 'migrated_pending'] as const;

const reinstateSchema = z.object({
  accountState: z.enum(REINSTATABLE_STATES),
  reason: reasonSchema,
});

/** Viewable by any administrator, matching the audit-trail's viewing tier -- not Super-Admin-gated,
 * consistent with listActiveRoles in role-grants.ts. */
export async function getUserAccountState(userId: number) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const [row] = await db.select({ accountState: users.accountState }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.accountState ?? null;
}

/**
 * Suspends a user's ability to authenticate. Revokes every active session and remembered
 * login-trust device immediately (so an already-authenticated session is cut off, not just future
 * logins) and bumps sessionVersion so a still-signed cookie can never be replayed back in. Uses
 * revokeLoginDeviceTrustForUser (DB-only) rather than forgetAllLoginDevices: the latter also
 * clears a browser cookie on the *current* response, which would be the administering admin's own
 * cookie, not the suspended user's -- meaningless (and mildly disruptive) for an admin action
 * targeting someone else's account. The suspended user's own trust cookie, if any, simply stops
 * verifying once its DB row is revoked, the same way any other login-device-trust revocation works.
 *
 * A user who currently holds an administrator/super_admin grant cannot be suspended through this
 * action: privilege removal goes through revokeApplicationRole (Super-Admin-only, protects the
 * last Super Admin) first. Without this check, an Administrator could use account suspension as a
 * side channel to disable a Super Admin's account while leaving their role grant -- and its
 * authority the moment the account is reinstated -- intact underneath.
 */
export async function suspendUserAccount(userId: number, untrustedReason: unknown) {
  const reason = reasonSchema.parse(untrustedReason);
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);

  await db.transaction(async (tx) => {
    const [current] = await tx.select({ accountState: users.accountState })
      .from(users).where(eq(users.id, userId)).for('update');
    if (!current) throw new Error('This user does not exist.');
    if (!SUSPENDABLE_STATES.includes(current.accountState as (typeof SUSPENDABLE_STATES)[number])) {
      throw new Error(current.accountState === 'suspended'
        ? 'This account is already suspended.'
        : 'This account cannot be suspended from its current state.');
    }
    const [activeGrant] = await tx.select({ id: applicationRoles.id }).from(applicationRoles)
      .where(and(eq(applicationRoles.userId, userId), isNull(applicationRoles.revokedAt))).limit(1);
    if (activeGrant) throw new Error("Remove this user's administrator/Super Admin role before suspending their account.");

    await tx.update(users).set({
      accountState: 'suspended',
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    }).where(eq(users.id, userId));
    await tx.insert(auditLog).values({
      action: 'admin.account.suspended', actorId: actor.id,
      afterJson: { accountState: 'suspended' }, beforeJson: { accountState: current.accountState },
      entityId: String(userId), entityType: 'user', reason,
    });
  });

  await revokeAllUserSessions(userId, 'account-suspended');
  await revokeLoginDeviceTrustForUser(userId, 'account-suspended');
  await enqueueAuthSecurityNotification({ dedupeKey: `account-suspended:${userId}:${Date.now()}`, kind: 'account_suspended', userId });
}

/** Restores a suspended account to a login-eligible state. The admin picks the target state explicitly
 * (mirroring reinstateMembership's pattern) rather than this function guessing what it was before. */
export async function reinstateUserAccount(userId: number, untrustedInput: unknown) {
  const input = reinstateSchema.parse(untrustedInput);
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);

  await db.transaction(async (tx) => {
    const [current] = await tx.select({ accountState: users.accountState })
      .from(users).where(eq(users.id, userId)).for('update');
    if (!current) throw new Error('This user does not exist.');
    if (current.accountState !== 'suspended') throw new Error('This account is not currently suspended.');

    await tx.update(users).set({
      accountState: input.accountState,
      updatedAt: new Date(),
    }).where(eq(users.id, userId));
    await tx.insert(auditLog).values({
      action: 'admin.account.reinstated', actorId: actor.id,
      afterJson: { accountState: input.accountState }, beforeJson: { accountState: 'suspended' },
      entityId: String(userId), entityType: 'user', reason: input.reason,
    });
  });

  await enqueueAuthSecurityNotification({ dedupeKey: `account-reinstated:${userId}:${Date.now()}`, kind: 'account_reinstated', userId });
}
