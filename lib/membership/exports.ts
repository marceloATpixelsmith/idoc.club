import 'server-only';

import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, notificationOutbox, payments, profiles, users } from '@/lib/db/schema';
import { requireAccountAccess } from './data-access';
import { requireAdministrator, requireSuperAdmin } from './authorization';

type MemberExportRow = { email: string; firstName: string; lastName: string; status: string | null; validUntil: string | null };

// AUTH-PRIVACY-001: "Authentication data MUST be ... bounded for retention/export ...". The
// members roster is a current-state list (not a temporally-growing log) and is exported in full;
// the three time-ordered history tables below are the ones a live production deployment can grow
// without bound, so their exports cap at the most recent EXPORT_ROW_LIMIT rows (already ordered
// newest-first) rather than allowing an unbounded, unreviewed full-history dump on every request.
export const EXPORT_ROW_LIMIT = 25_000;

export async function listAllMembersForExport() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const rows = await db.execute<MemberExportRow>(sql`
    select p.first_name as "firstName", p.last_name as "lastName", u.email,
      m.status, m.valid_until as "validUntil"
    from idoc.profiles p
    join idoc.users u on u.id = p.user_id
    left join lateral (
      select status, valid_until from idoc.memberships
      where profile_id = p.id order by valid_until desc, id desc limit 1
    ) m on true
    order by p.last_name
  `);
  return [...rows];
}

export async function listAllPaymentsForExport() {
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  return db.select({
    amountCents: payments.amountCents, currency: payments.currency, email: users.email,
    firstName: profiles.firstName, lastName: profiles.lastName, paidAt: payments.paidAt, source: payments.source,
  }).from(payments)
    .innerJoin(profiles, eq(payments.profileId, profiles.id))
    .innerJoin(users, eq(profiles.userId, users.id))
    .orderBy(desc(payments.paidAt))
    .limit(EXPORT_ROW_LIMIT);
}

export async function listAllAuditLogForExport() {
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(EXPORT_ROW_LIMIT);
}

export async function listAllNotificationsForExport() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return db.select({
    createdAt: notificationOutbox.createdAt, email: users.email, firstName: profiles.firstName,
    kind: notificationOutbox.kind, lastName: profiles.lastName, sentAt: notificationOutbox.sentAt,
  }).from(notificationOutbox)
    .innerJoin(profiles, eq(notificationOutbox.profileId, profiles.id))
    .innerJoin(users, eq(profiles.userId, users.id))
    .orderBy(desc(notificationOutbox.createdAt))
    .limit(EXPORT_ROW_LIMIT);
}
