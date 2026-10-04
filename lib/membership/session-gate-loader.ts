import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { applicationRoles, memberships, profiles, users } from '@/lib/db/schema';
import { classifySessionGate, type SessionGate } from './session-gate';

/** Reads the same facts authenticatedActor (data-access.ts) uses -- account state, active role
 * grants, and the latest membership -- and classifies them. One place decides who may see what, so
 * sign-in, Google sign-in and the per-request gate in middleware cannot drift apart. */
export async function loadSessionGate(userId: number, today: string = new Date().toISOString().slice(0, 10)): Promise<{ accountState: string; gate: SessionGate }> {
  const [account] = await db.select({ accountState: users.accountState }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account) return { accountState: 'unknown', gate: 'open' };
  const [grants, profile] = await Promise.all([
    db.select({ role: applicationRoles.role }).from(applicationRoles)
      .where(and(eq(applicationRoles.userId, userId), isNull(applicationRoles.revokedAt))),
    db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1),
  ]);
  const privileged = grants.some(({ role }) => role === 'administrator' || role === 'super_admin');
  const [latest] = profile[0]
    ? await db.select({ graceEndsOn: memberships.graceEndsOn, status: memberships.status, validUntil: memberships.validUntil })
      .from(memberships).where(eq(memberships.profileId, profile[0].id)).orderBy(desc(memberships.validUntil)).limit(1)
    : [];
  return {
    accountState: account.accountState,
    gate: classifySessionGate({ accountState: account.accountState, membership: latest ?? null, privileged, today }),
  };
}
