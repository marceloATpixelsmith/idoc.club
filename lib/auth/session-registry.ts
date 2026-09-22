import 'server-only';

import { sql } from 'drizzle-orm';
import { client, db } from '@/lib/db/drizzle';
import { MEMBER_SESSION_IDLE_SECONDS, SESSION_IDLE_SECONDS } from '@/lib/auth/session-tokens';

export type PersistedSession = {
  sessionId: string;
  userId: number;
  sessionVersion: number;
  authenticatedAt: string;
  lastActivityAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  deviceLabel: string | null;
};

type NewPersistedSession = {
  sessionId: string;
  userId: number;
  sessionVersion: number;
  authenticatedAt: Date;
  lastActivityAt: Date;
  absoluteExpiresAt: Date;
  deviceLabel?: string | null;
};

export async function userHasPrivilegedRole(userId: number): Promise<boolean> {
  const rows = await db.execute<{ privileged: boolean }>(sql`
    select exists(
      select 1
      from idoc.application_roles
      where user_id = ${userId}
        and revoked_at is null
        and role in ('administrator', 'super_admin')
    ) as privileged
  `);
  return Boolean(rows[0]?.privileged);
}

export async function registerSession(input: NewPersistedSession) {
  await db.execute(sql`
    insert into idoc.auth_sessions (
      session_id, user_id, session_version, authenticated_at, last_activity_at, absolute_expires_at, device_label
    ) values (
      ${input.sessionId}, ${input.userId}, ${input.sessionVersion}, ${input.authenticatedAt.toISOString()},
      ${input.lastActivityAt.toISOString()}, ${input.absoluteExpiresAt.toISOString()}, ${input.deviceLabel ?? null}
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
      revoke_reason as "revokeReason",
      device_label as "deviceLabel"
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

export async function revokeOtherUserSessions(userId: number, currentSessionId: string, reason: string) {
  await db.execute(sql`
    update idoc.auth_sessions
    set revoked_at = coalesce(revoked_at, now()), revoke_reason = coalesce(revoke_reason, ${reason}), updated_at = now()
    where user_id = ${userId} and session_id <> ${currentSessionId} and revoked_at is null
  `);
}

/** Atomic sign-in: the persisted session row and its audit_log evidence commit together, so a
 * connection drop between the two statements can never leave a phantom, un-audited session sitting
 * in the registry for up to its absolute lifetime. My Security's Activity card reads idoc.audit_log
 * directly (lib/auth/security-activity.ts names the exact action strings it renders). */
export async function registerSessionWithSignInAudit(input: NewPersistedSession) {
  await client.begin(async (tx) => {
    await tx`
      insert into idoc.auth_sessions (
        session_id, user_id, session_version, authenticated_at, last_activity_at, absolute_expires_at, device_label
      ) values (
        ${input.sessionId}, ${input.userId}, ${input.sessionVersion}, ${input.authenticatedAt.toISOString()},
        ${input.lastActivityAt.toISOString()}, ${input.absoluteExpiresAt.toISOString()}, ${input.deviceLabel ?? null}
      )
      on conflict (session_id) do nothing
    `;
    await tx`insert into idoc.audit_log(actor_id,action,entity_type,entity_id)
      values(${input.userId},'account.session.signed_in','user',${String(input.userId)})`;
  });
}

/** Atomic sign-out: the mirror of registerSessionWithSignInAudit above. Safe to call ahead of
 * clearSession()'s own revokeSession() (used by every OTHER caller of clearSession(), which must
 * not itself emit a "signed out" audit event) -- that later call's UPDATE is coalesce-idempotent
 * against the row this one already revoked, so it becomes a harmless no-op. */
export async function revokeSessionWithSignOutAudit(sessionId: string, userId: number) {
  await client.begin(async (tx) => {
    await tx`
      update idoc.auth_sessions
      set revoked_at=coalesce(revoked_at,now()),revoke_reason=coalesce(revoke_reason,'user-signout'),updated_at=now()
      where session_id=${sessionId} and user_id=${userId}
    `;
    await tx`insert into idoc.audit_log(actor_id,action,entity_type,entity_id)
      values(${userId},'account.session.signed_out','user',${String(userId)})`;
  });
}

export async function revokeOtherUserSessionsWithEvidence(input: {
  userId: number;
  currentSessionId: string;
  reason: string;
  dedupeKey: string;
  recipientEmail: string;
}) {
  return client.begin(async (tx) => {
    const revoked = await tx<{ session_id: string }[]>`
      update idoc.auth_sessions
      set revoked_at=coalesce(revoked_at,now()),revoke_reason=coalesce(revoke_reason,${input.reason}),updated_at=now()
      where user_id=${input.userId} and session_id<>${input.currentSessionId} and revoked_at is null
      returning session_id`;
    await tx`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,reason)
      values(${input.userId},'security.sessions.others_logged_out','user',${String(input.userId)},'member-security-page')`;
    await tx`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
      values(${input.userId},'other_sessions_revoked',${input.recipientEmail},${input.dedupeKey})
      on conflict (dedupe_key) where dedupe_key is not null do nothing`;
    return revoked.length;
  });
}

export async function listActiveSessions(userId: number, currentSessionVersion: number) {
  // A session's own cookie stops being honored once it's been idle past SESSION_IDLE_SECONDS (see
  // assertSessionFresh/registeredSessionIsValid) -- well before its absolute_expires_at, which is
  // fixed at authentication time and stays up to SESSION_ABSOLUTE_SECONDS (12h) in the future
  // regardless of activity. Filtering only on absolute_expires_at (as this used to) meant every
  // earlier sign-in from the same real session lingered on this list, looking "active," for up to
  // 12 hours after it had already gone idle-stale and stopped being usable by anyone -- a real
  // production report from an account that had signed in and out repeatedly on one browser in a
  // single day. last_activity_at is only ever advanced by touchSession, called from a request that
  // actually presented that exact session's still-valid cookie, so this bound reflects genuine
  // recent use, not merely "not yet past its fixed absolute deadline."
  const privileged = await userHasPrivilegedRole(userId);
  const idleSeconds = privileged ? SESSION_IDLE_SECONDS : MEMBER_SESSION_IDLE_SECONDS;
  const idleCutoff = new Date(Date.now() - idleSeconds * 1000);
  return db.execute<PersistedSession>(sql`
    select
      session_id as "sessionId",
      user_id as "userId",
      session_version as "sessionVersion",
      authenticated_at as "authenticatedAt",
      last_activity_at as "lastActivityAt",
      absolute_expires_at as "absoluteExpiresAt",
      revoked_at as "revokedAt",
      revoke_reason as "revokeReason",
      device_label as "deviceLabel"
    from idoc.auth_sessions
    where user_id = ${userId}
      and session_version = ${currentSessionVersion}
      and revoked_at is null
      and absolute_expires_at > now()
      and last_activity_at > ${idleCutoff.toISOString()}
    order by last_activity_at desc
  `);
}
