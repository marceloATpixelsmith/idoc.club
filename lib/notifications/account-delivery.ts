import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { accountDeliveryOutbox, accountTokens, auditLog } from '@/lib/db/schema';
import { decryptDeliveryPayload } from '@/lib/security/encrypted-payload';
import { sendTransactionalEmail } from './mailchimp-transactional';

const MAX_ATTEMPTS = 6;
const LEASE_MS = 5 * 60 * 1000;
const retrySeconds = (attempt: number) => Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));

export async function claimAccountDelivery(owner = randomUUID()) {
  const rows = await db.execute<typeof accountDeliveryOutbox.$inferSelect>(sql`
    with candidate as (
      select id from idoc.account_delivery_outbox
      where sent_at is null and dead_lettered_at is null and available_at <= now()
        and (lease_expires_at is null or lease_expires_at < now())
      order by available_at, id for update skip locked limit 1
    )
    update idoc.account_delivery_outbox outbox
    set lease_owner=${owner}, lease_expires_at=now() + (${LEASE_MS} * interval '1 millisecond')
    from candidate where outbox.id=candidate.id returning outbox.*
  `);
  return rows[0] ? { owner, record: rows[0] } : null;
}

export async function deliverNextAccountLink(owner = randomUUID()) {
  const claimed = await claimAccountDelivery(owner);
  if (!claimed) return { status: 'empty' as const };
  const { record } = claimed;
  try {
    const payload = decryptDeliveryPayload(record.encryptedPayload, record.keyVersion);
    const activation = record.purpose === 'migration_activation';
    const url = new URL(process.env.BASE_URL ?? 'http://localhost:3000');
    url.pathname = activation ? '/activate' : '/reset-password';
    url.searchParams.set('token', payload.token);
    await sendTransactionalEmail({ html: `<p><a href="${url.toString()}">${activation ? 'Activate your imported IDOC account' : 'Reset your password'}</a></p>`, messageId: record.messageId, subject: activation ? 'Activate your IDOC account' : 'Reset your IDOC password', to: payload.email });
    const finalized = await db.transaction(async (tx) => {
      const [done] = await tx.update(accountDeliveryOutbox).set({ attemptCount: sql`${accountDeliveryOutbox.attemptCount} + 1`, lastAttemptAt: new Date(), lastErrorCode: null, leaseExpiresAt: null, leaseOwner: null, sentAt: new Date() }).where(and(eq(accountDeliveryOutbox.id, record.id), eq(accountDeliveryOutbox.leaseOwner, owner), isNull(accountDeliveryOutbox.sentAt))).returning();
      if (!done) return false;
      await tx.update(accountTokens).set({ consumedAt: new Date() }).where(and(eq(accountTokens.userId, record.userId), eq(accountTokens.purpose, record.purpose), ne(accountTokens.id, record.tokenId), isNull(accountTokens.consumedAt)));
      await tx.insert(auditLog).values({ action: `account.${record.purpose}.delivery_succeeded`, entityId: String(record.userId), entityType: 'user' });
      return true;
    });
    return finalized ? { status: 'delivered' as const } : { status: 'lease_lost' as const };
  } catch {
    const nextAttempt = record.attemptCount + 1;
    await db.update(accountDeliveryOutbox).set({ attemptCount: nextAttempt, availableAt: sql`now() + (${retrySeconds(nextAttempt)} * interval '1 second')`, deadLetteredAt: nextAttempt >= MAX_ATTEMPTS ? new Date() : null, lastAttemptAt: new Date(), lastErrorCode: 'temporary_delivery_failure', leaseExpiresAt: null, leaseOwner: null }).where(and(eq(accountDeliveryOutbox.id, record.id), eq(accountDeliveryOutbox.leaseOwner, owner), isNull(accountDeliveryOutbox.sentAt)));
    return { status: nextAttempt >= MAX_ATTEMPTS ? 'dead_lettered' as const : 'retryable' as const };
  }
}
