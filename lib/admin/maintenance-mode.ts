import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { readActiveSession, sessionVersionIsCurrent } from '@/lib/auth/session-registry';
import type { SessionData } from '@/lib/auth/session-tokens';
import { db } from '@/lib/db/drizzle';
import { applicationRoles, auditLog, maintenanceMode } from '@/lib/db/schema';

const CACHE_MS = 3_000;
let cached: { enabled: boolean; at: number } | null = null;

/** Read by middleware on gated requests. A short per-instance cache keeps this to about one query per few seconds. If the flag
 * cannot be read the site stays up: failing closed here would lock everyone out of an application that is already unhealthy. */
export async function maintenanceModeEnabled(now: number = Date.now()): Promise<boolean> {
  if (cached && now - cached.at < CACHE_MS) return cached.enabled;
  try {
    const [row] = await db.select({ enabled: maintenanceMode.enabled }).from(maintenanceMode).where(eq(maintenanceMode.id, 1)).limit(1);
    cached = { enabled: row?.enabled === true, at: now };
  } catch {
    cached = { enabled: false, at: now };
  }
  return cached.enabled;
}

export function resetMaintenanceModeCacheForTests() { cached = null; }

export async function userIsSuperAdmin(userId: number): Promise<boolean> {
  const rows = await db.select({ role: applicationRoles.role }).from(applicationRoles)
    .where(and(eq(applicationRoles.userId, userId), eq(applicationRoles.role, 'super_admin'), isNull(applicationRoles.revokedAt))).limit(1);
  return rows.length > 0;
}

/** The same checks getSession() applies to a canonical session (active registry row, matching session version on the row, the token
 * and the user, and the same authenticated/absolute-expiry instants), then the Super Admin grant. A stale cookie after a password
 * reset or role change therefore never bypasses maintenance mode. Read-only: it does not touch last-activity. */
export async function sessionIsActiveSuperAdmin(session: SessionData): Promise<boolean> {
  const record = await readActiveSession(session.sessionId, session.user.id);
  if (!record) return false;
  if (record.sessionVersion !== session.user.sessionVersion) return false;
  if (!(await sessionVersionIsCurrent(session.user.id, session.user.sessionVersion))) return false;
  if (new Date(record.authenticatedAt).getTime() !== new Date(session.authenticatedAt).getTime()) return false;
  if (new Date(record.absoluteExpiresAt).getTime() !== new Date(session.absoluteExpiresAt).getTime()) return false;
  return userIsSuperAdmin(session.user.id);
}

export type MaintenanceState = { enabled: boolean; reason: string | null; changedAt: Date | null; changedByUserId: number | null };

export async function readMaintenanceState(): Promise<MaintenanceState> {
  const [row] = await db.select().from(maintenanceMode).where(eq(maintenanceMode.id, 1)).limit(1);
  return { enabled: row?.enabled === true, reason: row?.reason ?? null, changedAt: row?.changedAt ?? null, changedByUserId: row?.changedByUserId ?? null };
}

/** Turns maintenance on or off and records who did it, atomically with the audit row. Authorization and fresh MFA step-up are the
 * caller's job (the Backups page action); this only persists. */
export async function setMaintenanceMode(actorId: number, enabled: boolean, reason: string | null): Promise<void> {
  const cleanReason = reason?.trim().slice(0, 200) || null;
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ enabled: maintenanceMode.enabled }).from(maintenanceMode).where(eq(maintenanceMode.id, 1)).limit(1);
    await tx.insert(maintenanceMode).values({ id: 1, enabled, reason: cleanReason, changedByUserId: actorId, changedAt: new Date() })
      .onConflictDoUpdate({ target: maintenanceMode.id, set: { enabled, reason: cleanReason, changedByUserId: actorId, changedAt: new Date() } });
    await tx.insert(auditLog).values({
      actorId, action: enabled ? 'admin.maintenance_mode.enabled' : 'admin.maintenance_mode.disabled', entityType: 'maintenance_mode', entityId: '1',
      beforeJson: { enabled: before?.enabled ?? false }, afterJson: { enabled }, reason: cleanReason,
    });
  });
  cached = null;
}
