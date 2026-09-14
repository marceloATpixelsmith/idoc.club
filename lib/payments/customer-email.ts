import 'server-only';

import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, billingAccounts, notificationOutbox, profiles, reconciliationFindings, users } from '@/lib/db/schema';

export type CustomerEmailStripeClient = {
  customers: { update: (customerId: string, params: { email: string }) => Promise<unknown> };
};

/** Updates an existing Stripe identity; it never creates a Customer or Subscription. */
export async function updateStripeCustomerEmail(customerId: string, email: string, testStripe?: CustomerEmailStripeClient) {
  if (testStripe && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const key = process.env.STRIPE_SECRET_KEY;
  if (!testStripe && !key) throw new Error('Stripe Customer email synchronization is not configured.');
  await (testStripe ?? new Stripe(key as string)).customers.update(customerId, { email });
}

/** Lease-safe retry worker. Payload identifiers are ignored; ownership and email are re-read. */
export async function deliverNextStripeCustomerEmailSync(owner: string = randomUUID(), testStripe?: CustomerEmailStripeClient) {
  if (testStripe && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const [job] = await db.execute<{ attemptCount: number; id: number; profileId: number }>(sql`
    with candidate as (select id from idoc.notification_outbox
      where kind='stripe.customer_email_sync' and sent_at is null and dead_lettered_at is null
      and available_at <= now() and (lease_expires_at is null or lease_expires_at < now())
      order by available_at,id for update skip locked limit 1)
    update idoc.notification_outbox o set lease_owner=${owner}, lease_expires_at=now()+interval '5 minutes'
    from candidate where o.id=candidate.id returning o.id,o.profile_id as "profileId",o.attempt_count as "attemptCount"
  `);
  if (!job) return { status: 'empty' as const };
  try {
    const [owned] = await db.select({ customerId: billingAccounts.externalCustomerId, email: users.email })
      .from(billingAccounts).innerJoin(profiles, eq(profiles.id, billingAccounts.profileId))
      .innerJoin(users, eq(users.id, profiles.userId)).where(eq(billingAccounts.profileId, job.profileId)).limit(1);
    if (!owned) throw new Error('ownership_missing');
    await updateStripeCustomerEmail(owned.customerId, owned.email, testStripe);
    await db.transaction(async (tx) => {
      await tx.update(notificationOutbox).set({ leaseExpiresAt: null, leaseOwner: null, sentAt: new Date() })
        .where(and(eq(notificationOutbox.id, job.id), eq(notificationOutbox.leaseOwner, owner)));
      await tx.insert(auditLog).values({ action: 'stripe.customer_email_sync.completed',
        entityId: String(job.profileId), entityType: 'profile' });
    });
    return { status: 'sent' as const };
  } catch {
    const attempts = job.attemptCount + 1;
    await db.transaction(async (tx) => {
      await tx.update(notificationOutbox).set({ attemptCount: attempts, availableAt: new Date(Date.now() + 60_000 * 2 ** Math.min(attempts, 8)),
        deadLetteredAt: attempts >= 8 ? new Date() : null, lastAttemptAt: new Date(), lastErrorCode: 'stripe_sync_failed',
        leaseExpiresAt: null, leaseOwner: null }).where(and(eq(notificationOutbox.id, job.id), eq(notificationOutbox.leaseOwner, owner)));
      if (attempts >= 8) {
        await tx.insert(reconciliationFindings).values({ kind: 'unlinked_customer', profileId: job.profileId,
          summary: 'Stripe Customer email synchronization exhausted its retry budget.',
          details: { notificationOutboxId: job.id } });
        await tx.insert(auditLog).values({ action: 'stripe.customer_email_sync.dead_lettered',
          entityId: String(job.profileId), entityType: 'profile' });
      }
    });
    return { status: attempts >= 8 ? 'dead_lettered' as const : 'retry' as const };
  }
}

export async function processStripeCustomerEmailSyncBatch() {
  const summary = { deadLettered: 0, empty: 0, retried: 0, sent: 0 };
  for (let index = 0; index < 20; index += 1) {
    const result = await deliverNextStripeCustomerEmailSync();
    if (result.status === 'empty') { summary.empty += 1; break; }
    if (result.status === 'sent') summary.sent += 1;
    else if (result.status === 'retry') summary.retried += 1;
    else summary.deadLettered += 1;
  }
  return summary;
}
