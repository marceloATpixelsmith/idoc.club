import 'server-only';

import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  applicationRoles, auditLog, memberships, notificationOutbox,
  professionalRoles, profileChangeHistory, profiles,
  users,
} from '@/lib/db/schema';
import { getUser } from '@/lib/db/queries';
import { type Actor, requireAdministrator, requireOwnerOrAdmin } from './authorization';
import { memberProfileSchema, type MemberProfileInput } from './validation';
import { mayAccessAccountFunction, type AccountFunction, type AccountState } from './account-access';
import { isEntitled } from './entitlement';

async function authenticatedActor(operation: AccountFunction): Promise<Actor> {
  const user = await getUser();
  if (!user) throw new Error('Authentication required.');
  const [grants, profile] = await Promise.all([
    db.select({ role: applicationRoles.role }).from(applicationRoles)
      .where(and(eq(applicationRoles.userId, user.id), isNull(applicationRoles.revokedAt))),
    db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, user.id)).limit(1),
  ]);
  const actor = { id: user.id, roles: grants.map(({ role }) => role) };
  const latest = profile[0]
    ? await db.select({ status: memberships.status, validUntil: memberships.validUntil })
      .from(memberships).where(eq(memberships.profileId, profile[0].id))
      .orderBy(desc(memberships.validUntil)).limit(1)
    : [];
  const entitled = latest[0]
    ? isEntitled(latest[0], new Date().toISOString().slice(0, 10))
    : false;
  if (!mayAccessAccountFunction({
    accountState: user.accountState as AccountState,
    actor,
    entitled,
  }, operation)) throw new Error('Account access denied.');
  return actor;
}

export async function requireAccountAccess(operation: AccountFunction) {
  return authenticatedActor(operation);
}

export async function getPrivateMember(profileId: number) {
  const actor = await authenticatedActor('profile');
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!profile) return null;
  requireOwnerOrAdmin(actor, profile.userId);
  const [roles, entitlement] = await Promise.all([
    db.select().from(professionalRoles).where(and(eq(professionalRoles.profileId, profile.id), isNull(professionalRoles.effectiveTo))),
    db.select().from(memberships).where(eq(memberships.profileId, profile.id)).orderBy(desc(memberships.validUntil)).limit(1),
  ]);
  return { entitlement: entitlement[0] ?? null, profile, roles };
}

export async function getOwnPrivateMember() {
  const actor = await authenticatedActor('profile');
  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, actor.id)).limit(1);
  return profile ? getPrivateMember(profile.id) : null;
}

export async function createOwnMemberProfile(untrustedInput: unknown) {
  const input = memberProfileSchema.parse(untrustedInput);
  const actor = await authenticatedActor('onboarding');
  return db.transaction(async (tx) => {
    const [account] = await tx.execute<{ account_state: string }>(sql`
      select account_state from idoc.users where id = ${actor.id} for update
    `);
    if (!account || account.account_state !== 'onboarding') {
      throw new Error('This account is not eligible for onboarding.');
    }
    const [existing] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, actor.id)).limit(1);
    if (existing) throw new Error('A member profile already exists for this account.');
    const [profile] = await tx.insert(profiles).values({ ...profileColumns(input), userId: actor.id }).returning();
    await tx.insert(professionalRoles).values(input.roles.map((role) => ({ ...role, profileId: profile.id })));
    const after = { profile, roles: input.roles };
    await tx.insert(profileChangeHistory).values({ actorId: actor.id, afterJson: after, beforeJson: {}, profileId: profile.id });
    await tx.insert(auditLog).values({ action: 'member.profile.created', actorId: actor.id, afterJson: after, entityId: String(profile.id), entityType: 'profile' });
    await tx.update(users).set({ accountState: 'active', updatedAt: new Date() })
      .where(and(eq(users.id, actor.id), eq(users.accountState, 'onboarding')));
    await tx.insert(auditLog).values({
      action: 'account.onboarding.completed', actorId: actor.id,
      afterJson: { accountState: 'active' }, beforeJson: { accountState: 'onboarding' },
      entityId: String(actor.id), entityType: 'user',
    });
    return profile;
  });
}

export async function updateMemberProfile(profileId: number, untrustedInput: unknown) {
  const input = memberProfileSchema.parse(untrustedInput);
  const actor = await authenticatedActor('profile');
  const [existing] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!existing) throw new Error('Member profile not found.');
  requireOwnerOrAdmin(actor, existing.userId);

  return db.transaction(async (tx) => {
    const beforeRoles = await tx.select().from(professionalRoles)
      .where(and(eq(professionalRoles.profileId, profileId), isNull(professionalRoles.effectiveTo)));
    const now = new Date();
    const profileValues = profileColumns(input);
    const [updated] = await tx.update(profiles).set({ ...profileValues, updatedAt: now })
      .where(eq(profiles.id, profileId)).returning();
    await tx.update(professionalRoles).set({ effectiveTo: now })
      .where(and(eq(professionalRoles.profileId, profileId), isNull(professionalRoles.effectiveTo)));
    await tx.insert(professionalRoles).values(input.roles.map((role) => ({
      ...role, profileId, effectiveFrom: now,
    })));
    const before = { profile: existing, roles: beforeRoles };
    const after = { profile: updated, roles: input.roles };
    await tx.insert(profileChangeHistory).values({ actorId: actor.id, afterJson: after, beforeJson: before, profileId });
    await tx.insert(auditLog).values({
      action: actor.id === existing.userId ? 'member.profile.updated' : 'admin.profile.updated',
      actorId: actor.id, afterJson: after, beforeJson: before,
      entityId: String(profileId), entityType: 'profile',
    });
    if (actor.id === existing.userId) {
      await tx.insert(notificationOutbox).values({ kind: 'administrator.profile_changed', payload: { actorId: actor.id }, profileId });
    }
    return updated;
  });
}

export async function listAuditHistory(profileId: number) {
  const actor = await authenticatedActor('administration');
  requireAdministrator(actor);
  return db.select().from(auditLog).where(and(eq(auditLog.entityType, 'profile'), eq(auditLog.entityId, String(profileId))))
    .orderBy(desc(auditLog.createdAt));
}

export async function hasCurrentMemberEntitlement(profileId: number): Promise<boolean> {
  const actor = await authenticatedActor('profile');
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!profile) return false;
  requireOwnerOrAdmin(actor, profile.userId);
  const today = new Date().toISOString().slice(0, 10);
  const [record] = await db.select({ id: memberships.id }).from(memberships).where(and(
    eq(memberships.profileId, profileId),
    inArray(memberships.status, ['active', 'grace', 'complimentary', 'canceled']),
    or(gt(memberships.validUntil, today), eq(memberships.validUntil, today)),
  )).limit(1);
  return Boolean(record);
}

function profileColumns(input: MemberProfileInput) {
  const { roles: _roles, ...profile } = input;
  return profile;
}
