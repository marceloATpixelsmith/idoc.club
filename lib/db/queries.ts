import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './drizzle';
import { auditLog, profiles, users } from './schema';
import { getSession } from '@/lib/auth/session';
import { SECURITY_ACTIVITY_LABELS } from '@/lib/auth/security-activity';

export type PublicUser = { email: string; firstName: string | null; id: number; lastName: string | null };
export type SecurityPageUser = { accountState: 'active' | 'onboarding'; id: number; sessionVersion: number };

/** AUTH-API-003: the only user-shaped value ever sent to the browser -- every server-rendered
 * consumer of the current user's identity (the root layout's SWR fallback, the /api/user route
 * both hydrate from) must go through this, never the full getUser() row, which also carries
 * passwordHash, sessionVersion, accountState, and other server-only fields. */
export async function getPublicUser(): Promise<PublicUser | null> {
  const user = await getUser();
  if (!user) return null;
  const [profile] = await db.select({ firstName: profiles.firstName, lastName: profiles.lastName })
    .from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  return {
    email: user.emailDisplay ?? user.email,
    firstName: profile?.firstName ?? null,
    id: user.id,
    lastName: profile?.lastName ?? null,
  };
}

/** Authenticates the current session while selecting only the fields the server-rendered security
 * page needs. A full users row must not cross a Server Component render boundary because React's
 * development Flight tracing can serialize an awaited value even when it is not passed as a prop. */
export async function getSecurityPageUser(): Promise<SecurityPageUser | null> {
  const sessionData = await getSession();
  if (!sessionData) return null;

  const [user] = await db
    .select({
      accountState: users.accountState,
      emailVerifiedAt: users.emailVerifiedAt,
      id: users.id,
      sessionVersion: users.sessionVersion,
    })
    .from(users)
    .where(and(eq(users.id, sessionData.user.id), isNull(users.deletedAt)))
    .limit(1);

  if (!user?.emailVerifiedAt || !['active', 'onboarding'].includes(user.accountState) ||
      user.sessionVersion !== sessionData.user.sessionVersion) {
    return null;
  }

  return { accountState: user.accountState as 'active' | 'onboarding', id: user.id, sessionVersion: user.sessionVersion };
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

/** Powers My Security's Activity card with the member's own real security history -- idoc.audit_log
 * rows they themselves caused, restricted to SECURITY_ACTIVITY_LABELS' curated allow-list so this
 * stays a security activity feed rather than a general account-history dump. */
export async function getActivityLogs() {
  const { requireAccountAccess } = await import('@/lib/membership/data-access');
  await requireAccountAccess('member');
  const session = await getSession();
  if (!session) {
    throw new Error('User not authenticated');
  }

  return await db
    .select({ id: auditLog.id, action: auditLog.action, timestamp: auditLog.createdAt })
    .from(auditLog)
    .where(and(eq(auditLog.actorId, session.user.id), inArray(auditLog.action, Object.keys(SECURITY_ACTIVITY_LABELS))))
    .orderBy(desc(auditLog.createdAt))
    .limit(10);
}
