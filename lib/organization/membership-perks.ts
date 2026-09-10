import { asc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, membershipPerks } from '@/lib/db/schema';
import { requireSuperAdmin, type Actor } from '@/lib/membership/authorization';
import 'server-only';

export type MembershipPerk = { id: number; label: string };

/** Public read: the perk list shown on the membership page and the dashboard payment box. */
export async function getMembershipPerks(): Promise<MembershipPerk[]> {
  return db.select({ id: membershipPerks.id, label: membershipPerks.label }).from(membershipPerks)
    .orderBy(asc(membershipPerks.displayOrder));
}

export async function getMembershipPerksForAdmin(actor: Actor): Promise<MembershipPerk[]> {
  requireSuperAdmin(actor);
  return getMembershipPerks();
}

/** Full replace: the admin form submits the complete, ordered list of labels every save, so the
 * simplest correct update is delete-and-reinsert in one transaction rather than diffing individual
 * row ids the client never needs to track. */
export async function updateMembershipPerks(actor: Actor, labels: string[]): Promise<void> {
  requireSuperAdmin(actor);
  if (labels.length > 50) throw new Error('A maximum of 50 membership perks is allowed.');
  const cleaned = labels.map((label) => label.trim()).filter(Boolean).map((label) => label.slice(0, 200));
  if (cleaned.length === 0) throw new Error('At least one perk is required.');

  await db.transaction(async (tx) => {
    // SERIALIZE FULL-LIST REPLACEMENTS ON A STABLE TRANSACTION-LEVEL LOCK.
    await tx.execute(sql`select pg_advisory_xact_lock(2147483647, 45)`);
    const before = await tx.select({ label: membershipPerks.label }).from(membershipPerks).orderBy(asc(membershipPerks.displayOrder)).for('update');
    await tx.delete(membershipPerks);
    await tx.insert(membershipPerks).values(cleaned.map((label, index) => ({ label, displayOrder: (index + 1) * 10 })));
    if (before.map((row) => row.label).join('\n') !== cleaned.join('\n')) {
      await tx.insert(auditLog).values({ action: 'admin.membership_perks.updated', actorId: actor.id, entityId: 'all', entityType: 'membership_perks',
        beforeJson: { labels: before.map((row) => row.label) }, afterJson: { labels: cleaned } });
    }
  });
}
