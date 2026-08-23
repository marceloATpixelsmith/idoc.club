import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';

export type PersistedSession = {
  sessionId: string;
  userId: number;
  sessionVersion: number;
  authenticatedAt: Date;
  lastActivityAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
};

export async function registerSession(input: Omit<PersistedSession, 'revokedAt' | 'revokeReason'>) {
  await db.execute(sql`
    insert into idoc.auth_sessions (
      session_id, user_id, session_version, authenticated_at, last_activity_at, absolute_expires_at
    ) values (
      ${input.sessionId}, ${input.userId}, ${input.sessionVersion}, ${input.authenticatedAt.toISOString()},
      ${input.lastActivityAt.toISOString()}, ${input.absoluteExpiresAt.toISOString()}
    )
    on conflict (session_id) do nothing
  `);
}

export async function readActiveSession(sessionId: string, userId: number) {
  const rows = await db.execute<PersistedSession>(sql`
    select
      session_id as "sessionId",
      user_id as "userId",
      session_version as "sessionVersion",
      authenticated_at as "authenticatedAt",
      last_activity_at as "lastActivityAt",
      absolute_expires_at as "absoluteExpiresAt",
      revoked_at as "revokedAt",
      revoke_reason as "revokeReason"
    from idoc.auth_sessions
    where session_id = ${sessionId}
      and user_id = ${userId}
      and revoked_at is null
      and absolute_expires_at > now()
    limit 1
  `);
  return rows[0] ?? null;
}

export async function touchSession(sessionId: string, userId: number, lastActivityAt: Date) {
  await db.execute(sql`
    update idoc.auth_sessions
    set last_activity_at = ${lastActivityAt.toISOString()}, updated_at = now()
    where session_id = ${sessionId}
      and user_id = ${userId}
      and revoked_at is null
      and absolute_expires_at > now()
  `);
}

export async function revokeSession(sessionId: string, userId: number, reason = 'user-signout') {
  await db.execute(sql`
    update idoc.auth_sessions
    set revoked_at = coalesce(revoked_at, now()), revoke_reason = coalesce(revoke_reason, ${reason}), updated_at = now()
    where session_id = ${sessionId} and user_id = ${userId}
  `);
}

export async function revokeAllUserSessions(userId: number, reason: string) {
  await db.execute(sql`
    update idoc.auth_sessions
    set revoked_at = coalesce(revoked_at, now()), revoke_reason = coalesce(revoke_reason, ${reason}), updated_at = now()
    where user_id = ${userId} and revoked_at is null
  `);
}

export async function listActiveSessions(userId: number) {
  return db.execute<PersistedSession>(sql`
    select
      session_id as "sessionId",
      user_id as "userId",
      session_version as "sessionVersion",
      authenticated_at as "authenticatedAt",
      last_activity_at as "lastActivityAt",
      absolute_expires_at as "absoluteExpiresAt",
      revoked_at as "revokedAt",
      revoke_reason as "revokeReason"
    from idoc.auth_sessions
    where user_id = ${userId}
      and revoked_at is null
      and absolute_expires_at > now()
    order by last_activity_at desc
  `);
}
