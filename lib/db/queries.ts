import { desc, and, eq, isNull } from 'drizzle-orm';
import { db } from './drizzle';
import { activityLogs, users } from './schema';
import { getSession } from '@/lib/auth/session';

export type PublicUser = { email: string; id: number; name: string | null };

/** AUTH-API-003: the only user-shaped value ever sent to the browser -- every server-rendered
 * consumer of the current user's identity (the root layout's SWR fallback, the /api/user route
 * both hydrate from) must go through this, never the full getUser() row, which also carries
 * passwordHash, sessionVersion, accountState, and other server-only fields. */
export async function getPublicUser(): Promise<PublicUser | null> {
  const user = await getUser();
  return user ? { email: user.emailDisplay ?? user.email, id: user.id, name: user.name } : null;
}

export async function getUser() {
  const sessionData = await getSession();
  if (!sessionData) return null;

  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.id, sessionData.user.id), isNull(users.deletedAt)))
    .limit(1);

  if (user.length === 0 || !user[0].emailVerifiedAt ||
      !['active', 'onboarding'].includes(user[0].accountState) ||
      user[0].sessionVersion !== sessionData.user.sessionVersion) {
    return null;
  }

  return user[0];
}

export async function getActivityLogs() {
  const { requireAccountAccess } = await import('@/lib/membership/data-access');
  await requireAccountAccess('member');
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  return await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      timestamp: activityLogs.timestamp,
      userName: users.name
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .where(eq(activityLogs.userId, user.id))
    .orderBy(desc(activityLogs.timestamp))
    .limit(10);
}
