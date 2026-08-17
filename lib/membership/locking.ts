import 'server-only';

import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { memberships } from '@/lib/db/schema';

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Locks the selected row for the rest of this transaction so a concurrent webhook event, manual
// payment, or admin status change for the same profile can't read the same pre-update validUntil
// and derive conflicting results, silently dropping one of two concurrent writes.
export async function lockLatestMembership(tx: Transaction, profileId: number) {
  const [membership] = await tx.select().from(memberships).where(eq(memberships.profileId, profileId))
    .orderBy(desc(memberships.validUntil)).limit(1).for('update');
  return membership ?? null;
}
