import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { notificationOutbox } from '@/lib/db/schema';
import { sendTransactionalEmail } from './mailchimp-transactional';

const MAX_ATTEMPTS = 6;
export async function deliverProfileChangeNotification(_outboxId?: number, owner: string = randomUUID()) {
  const rows = await db.execute<typeof notificationOutbox.$inferSelect>(sql`
    with candidate as (select id from idoc.notification_outbox where kind='administrator.profile_changed'
      and sent_at is null and dead_lettered_at is null and available_at <= now()
      and (lease_expires_at is null or lease_expires_at < now())
      ${_outboxId ? sql`and id=${_outboxId}` : sql``}
      order by available_at,id for update skip locked limit 1)
    update idoc.notification_outbox o set lease_owner=${owner}, lease_expires_at=now()+interval '5 minutes'
    from candidate where o.id=candidate.id returning o.*
  `);
  const record = rows[0];
  if (!record) return { status: 'already_delivered' as const };
  try {
    const to = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
    if (!to) throw new Error('not_configured');
    await sendTransactionalEmail({ html: '<p>A member profile was changed. Review it in the administrator area.</p>', messageId: `profile-change-${record.id}`, subject: 'IDOC member profile changed', to });
    const finalized = await db.update(notificationOutbox).set({ attemptCount: sql`${notificationOutbox.attemptCount} + 1`, lastAttemptAt: new Date(), lastErrorCode: null, leaseExpiresAt: null, leaseOwner: null, sentAt: new Date() }).where(and(eq(notificationOutbox.id, record.id), eq(notificationOutbox.leaseOwner, owner), isNull(notificationOutbox.sentAt))).returning({ id: notificationOutbox.id });
    return finalized.length ? { status: 'delivered' as const } : { status: 'lease_lost' as const };
  } catch {
    const attempt = record.attemptCount + 1;
    await db.update(notificationOutbox).set({ attemptCount: attempt, availableAt: sql`now() + (${Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1))} * interval '1 second')`, deadLetteredAt: attempt >= MAX_ATTEMPTS ? new Date() : null, lastAttemptAt: new Date(), lastErrorCode: 'temporary_delivery_failure', leaseExpiresAt: null, leaseOwner: null }).where(and(eq(notificationOutbox.id, record.id), eq(notificationOutbox.leaseOwner, owner)));
    return { status: attempt >= MAX_ATTEMPTS ? 'dead_lettered' as const : 'retryable' as const };
  }
}
