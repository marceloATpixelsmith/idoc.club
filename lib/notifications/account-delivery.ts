import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { accountDeliveryOutbox, accountTokens, auditLog } from '@/lib/db/schema';
import { decryptDeliveryPayload } from '@/lib/security/encrypted-payload';
import { sendTransactionalEmail } from './mailchimp-transactional';
import { ACCOUNT_DELIVERY_BATCH_LIMIT, processDeliveryBatch } from './account-delivery-worker-core';

const MAX_ATTEMPTS = 6;
const LEASE_MS = 5 * 60 * 1000;
const retrySeconds = (attempt: number) => Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));

/** Atomically leases an eligible row and terminalizes invalid rows encountered ahead of it. */
export async function claimAccountDelivery(owner = randomUUID()) {
  for (;;) {
    const rows = await db.execute<(typeof accountDeliveryOutbox.$inferSelect) & { eligible: boolean }>(sql`
      with candidate as (
        select o.id,
          (t.id is not null and t.user_id=o.user_id and t.purpose=o.purpose
            and t.consumed_at is null and t.expires_at > now()) as eligible,
          case
            when t.id is null then 'missing_token'
            when t.user_id<>o.user_id then 'user_mismatch'
            when t.purpose<>o.purpose then 'purpose_mismatch'
            when t.consumed_at is not null then 'consumed_token'
            else 'expired_token'
          end as terminal_reason
        from idoc.account_delivery_outbox o
        left join idoc.account_tokens t on t.id=o.token_id
        where o.sent_at is null and o.dead_lettered_at is null and o.terminal_at is null
          and o.available_at <= now() and (o.lease_expires_at is null or o.lease_expires_at < now())
        order by o.available_at, o.id for update of o skip locked limit 1
      )
      update idoc.account_delivery_outbox outbox set
        lease_owner=case when candidate.eligible then ${owner} else null end,
        lease_expires_at=case when candidate.eligible then now() + (${LEASE_MS} * interval '1 millisecond') else null end,
        terminal_at=case when candidate.eligible then null else now() end,
        terminal_reason=case when candidate.eligible then null else candidate.terminal_reason end
      from candidate where outbox.id=candidate.id returning outbox.*, candidate.eligible
    `);
    if (!rows[0]) return null;
    if (rows[0].eligible) return { owner, record: rows[0] };
  }
}

export async function deliverNextAccountLink(owner = randomUUID()) {
  const claimed = await claimAccountDelivery(owner);
  if (!claimed) return { status: 'empty' as const };
  const { record } = claimed;
  try {
    const finalized = await db.transaction(async (tx) => {
      // Lock and re-check immediately before the external call. Token consumption cannot
      // race this delivery because its update must wait for this transaction to finish.
      const eligible = await tx.execute<{ expires_at: Date }>(sql`
        select t.expires_at from idoc.account_tokens t
        join idoc.account_delivery_outbox o on o.token_id=t.id
        where o.id=${record.id} and o.lease_owner=${owner} and o.lease_expires_at>now()
          and o.sent_at is null and o.terminal_at is null and t.user_id=o.user_id
          and t.purpose=o.purpose and t.consumed_at is null and t.expires_at>now()
        for update of t, o
      `);
      if (!eligible[0]) {
        await tx.update(accountDeliveryOutbox).set({ leaseExpiresAt: null, leaseOwner: null, terminalAt: new Date(), terminalReason: 'token_ineligible' }).where(and(eq(accountDeliveryOutbox.id, record.id), eq(accountDeliveryOutbox.leaseOwner, owner), isNull(accountDeliveryOutbox.sentAt)));
        return 'ineligible' as const;
      }
      const payload = decryptDeliveryPayload(record.encryptedPayload, record.keyVersion);
      const activation = record.purpose === 'migration_activation';
      const url = new URL(process.env.BASE_URL ?? 'http://localhost:3000');
      url.pathname = activation ? '/activate' : '/reset-password';
      url.searchParams.set('token', payload.token);
      await sendTransactionalEmail({ html: `<p><a href="${url.toString()}">${activation ? 'Activate your imported IDOC account' : 'Reset your password'}</a></p>`, messageId: record.messageId, subject: activation ? 'Activate your IDOC account' : 'Reset your IDOC password', to: payload.email });
      const [done] = await tx.update(accountDeliveryOutbox).set({ attemptCount: sql`${accountDeliveryOutbox.attemptCount} + 1`, lastAttemptAt: new Date(), lastErrorCode: null, leaseExpiresAt: null, leaseOwner: null, sentAt: new Date() }).where(and(eq(accountDeliveryOutbox.id, record.id), eq(accountDeliveryOutbox.leaseOwner, owner), isNull(accountDeliveryOutbox.sentAt))).returning();
      if (!done) return 'lease_lost' as const;
      await tx.update(accountTokens).set({ consumedAt: new Date() }).where(and(eq(accountTokens.userId, record.userId), eq(accountTokens.purpose, record.purpose), ne(accountTokens.id, record.tokenId), isNull(accountTokens.consumedAt)));
      await tx.insert(auditLog).values({ action: `account.${record.purpose}.delivery_succeeded`, entityId: String(record.userId), entityType: 'user' });
      return 'delivered' as const;
    });
    return { status: finalized };
  } catch {
    const nextAttempt = record.attemptCount + 1;
    await db.update(accountDeliveryOutbox).set({ attemptCount: nextAttempt, availableAt: sql`now() + (${retrySeconds(nextAttempt)} * interval '1 second')`, deadLetteredAt: nextAttempt >= MAX_ATTEMPTS ? new Date() : null, lastAttemptAt: new Date(), lastErrorCode: 'temporary_delivery_failure', leaseExpiresAt: null, leaseOwner: null }).where(and(eq(accountDeliveryOutbox.id, record.id), eq(accountDeliveryOutbox.leaseOwner, owner), isNull(accountDeliveryOutbox.sentAt)));
    return { status: nextAttempt >= MAX_ATTEMPTS ? 'dead_lettered' as const : 'retryable' as const };
  }
}

export async function processAccountDeliveryBatch(limit = ACCOUNT_DELIVERY_BATCH_LIMIT) {
  return processDeliveryBatch(deliverNextAccountLink, limit);
}
