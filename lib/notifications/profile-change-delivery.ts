import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { notificationOutbox } from '@/lib/db/schema';
import { sendTransactionalEmail } from './mailchimp-transactional';

/** Retry-safe delivery boundary. A scheduler may repeatedly call it with an outbox id. */
export async function deliverProfileChangeNotification(outboxId: number) {
  const [record] = await db.select().from(notificationOutbox).where(and(eq(notificationOutbox.id, outboxId), eq(notificationOutbox.kind, 'administrator.profile_changed'), isNull(notificationOutbox.sentAt))).limit(1);
  if (!record) return { status: 'already_delivered' as const };
  try {
    const administratorEmail = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
    if (!administratorEmail) throw new Error('not_configured');
    await sendTransactionalEmail({ html: '<p>A member profile was changed. Review it in the administrator area.</p>', subject: 'IDOC member profile changed', to: administratorEmail });
    await db.update(notificationOutbox).set({ attemptCount: sql`${notificationOutbox.attemptCount} + 1`, lastAttemptAt: new Date(), lastErrorCode: null, sentAt: new Date() }).where(and(eq(notificationOutbox.id, outboxId), isNull(notificationOutbox.sentAt)));
    return { status: 'delivered' as const };
  } catch {
    await db.update(notificationOutbox).set({ attemptCount: sql`${notificationOutbox.attemptCount} + 1`, lastAttemptAt: new Date(), lastErrorCode: 'temporary_delivery_failure' }).where(eq(notificationOutbox.id, outboxId));
    return { status: 'retryable' as const };
  }
}
