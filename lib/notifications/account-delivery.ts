import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { accountDeliveryOutbox, accountTokens, auditLog } from '@/lib/db/schema';
import { decryptDeliveryPayload } from '@/lib/security/encrypted-payload';
import { sendTransactionalEmail } from './mailchimp-transactional';
import { ACCOUNT_DELIVERY_BATCH_LIMIT, processDeliveryBatch } from './account-delivery-worker-core';
import { baseUrlForServer } from '@/lib/runtime/configuration';

export const ACCOUNT_DELIVERY_MAX_ATTEMPTS = 6;
const LEASE_MS = 5 * 60 * 1000;
export const accountDeliveryRetrySeconds = (attempt: number) => Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));

interface DeliveryDependencies {
  afterClaim?: (record: typeof accountDeliveryOutbox.$inferSelect) => Promise<void>;
  beforeFinalize?: (record: typeof accountDeliveryOutbox.$inferSelect) => Promise<void>;
  now: () => Date;
  send: typeof sendTransactionalEmail;
}

const productionDependencies: DeliveryDependencies = { now: () => new Date(), send: sendTransactionalEmail };

function dependenciesForTest(overrides?: Partial<DeliveryDependencies>) {
  if (overrides && process.env.NODE_ENV !== 'test') throw new Error('Delivery dependency overrides are test-only.');
  return { ...productionDependencies, ...overrides };
}

/** Atomically leases one eligible row or terminalizes one invalid row. */
export async function claimAccountDelivery(owner: string = randomUUID(), now = new Date()) {
  const rows = await db.execute<(typeof accountDeliveryOutbox.$inferSelect) & { eligible: boolean }>(sql`
      with candidate as (
        select o.id,
          (t.id is not null and t.user_id=o.user_id and t.purpose=o.purpose
            and t.consumed_at is null and t.expires_at > ${now.toISOString()}
            and ((o.purpose='password_reset' and u.account_state in ('active','onboarding'))
              or (o.purpose='migration_activation' and u.account_state='migrated_pending'))) as eligible,
          case
            when t.id is null then 'missing_token'
            when t.user_id<>o.user_id then 'user_mismatch'
            when t.purpose<>o.purpose then 'purpose_mismatch'
            when t.consumed_at is not null then 'consumed_token'
            when t.expires_at <= ${now.toISOString()} then 'expired_token'
            when not ((o.purpose='password_reset' and u.account_state in ('active','onboarding'))
              or (o.purpose='migration_activation' and u.account_state='migrated_pending')) then 'account_ineligible'
            else 'expired_token'
          end as terminal_reason
        from idoc.account_delivery_outbox o
        left join idoc.account_tokens t on t.id=o.token_id
        left join idoc.users u on u.id=o.user_id
        where o.sent_at is null and o.dead_lettered_at is null and o.terminal_at is null
          and o.available_at <= ${now.toISOString()} and (o.lease_expires_at is null or o.lease_expires_at < ${now.toISOString()})
        order by o.available_at, o.id for update of o skip locked limit 1
      )
      update idoc.account_delivery_outbox outbox set
        lease_owner=case when candidate.eligible then ${owner} else null end,
        lease_expires_at=case when candidate.eligible then ${now.toISOString()}::timestamptz + (${LEASE_MS} * interval '1 millisecond') else null end,
        terminal_at=case when candidate.eligible then null else ${now.toISOString()}::timestamptz end,
        terminal_reason=case when candidate.eligible then null else candidate.terminal_reason end
      from candidate where outbox.id=candidate.id returning outbox.*, candidate.eligible
  `);
  if (!rows[0]) return null;
  if (!rows[0].eligible) return { status: 'ineligible' as const };
  return { owner, record: rows[0], status: 'claimed' as const };
}

export async function deliverNextAccountLink(owner: string = randomUUID(), testDependencies?: Partial<DeliveryDependencies>) {
  const dependencies = dependenciesForTest(testDependencies);
  const claimed = await claimAccountDelivery(owner, dependencies.now());
  if (!claimed) return { status: 'empty' as const };
  if (claimed.status === 'ineligible') return claimed;
  const { record } = claimed;
  try {
    await dependencies.afterClaim?.(record);
    const finalized = await db.transaction(async (tx) => {
      // Lock and re-check immediately before the external call. Token consumption cannot
      // race this delivery because its update must wait for this transaction to finish.
      const eligible = await tx.execute<{ expires_at: Date }>(sql`
        select t.expires_at from idoc.account_tokens t
        join idoc.account_delivery_outbox o on o.token_id=t.id
        where o.id=${record.id} and o.lease_owner=${owner} and o.lease_expires_at>${dependencies.now().toISOString()}
          and o.sent_at is null and o.dead_lettered_at is null and o.terminal_at is null and t.user_id=o.user_id
          and t.purpose=o.purpose and t.consumed_at is null and t.expires_at>${dependencies.now().toISOString()}
          and ((o.purpose='password_reset' and exists(select 1 from idoc.users u where u.id=o.user_id and u.account_state in ('active','onboarding')))
            or (o.purpose='migration_activation' and exists(select 1 from idoc.users u where u.id=o.user_id and u.account_state='migrated_pending')))
        for update of t, o
      `);
      if (!eligible[0]) {
        await tx.update(accountDeliveryOutbox).set({ leaseExpiresAt: null, leaseOwner: null, terminalAt: dependencies.now(), terminalReason: 'token_ineligible' }).where(and(eq(accountDeliveryOutbox.id, record.id), eq(accountDeliveryOutbox.leaseOwner, owner), isNull(accountDeliveryOutbox.sentAt)));
        return 'ineligible' as const;
      }
      const payload = decryptDeliveryPayload(record.encryptedPayload, record.keyVersion);
      const activation = record.purpose === 'migration_activation';
      const url = new URL(baseUrlForServer());
      url.pathname = activation ? '/activate' : '/reset-password';
      url.searchParams.set('token', payload.token);
      await dependencies.send({ html: `<p><a href="${url.toString()}">${activation ? 'Activate your imported IDOC account' : 'Reset your password'}</a></p>`, messageId: record.messageId, subject: activation ? 'Activate your IDOC account' : 'Reset your IDOC password', to: payload.email });
      await dependencies.beforeFinalize?.(record);
      const completedAt = dependencies.now();
      const [done] = await tx.update(accountDeliveryOutbox).set({ attemptCount: sql`${accountDeliveryOutbox.attemptCount} + 1`, lastAttemptAt: completedAt, lastErrorCode: null, leaseExpiresAt: null, leaseOwner: null, sentAt: completedAt }).where(and(eq(accountDeliveryOutbox.id, record.id), eq(accountDeliveryOutbox.leaseOwner, owner), isNull(accountDeliveryOutbox.sentAt))).returning();
      if (!done) return 'lease_lost' as const;
      await tx.update(accountTokens).set({ consumedAt: new Date() }).where(and(eq(accountTokens.userId, record.userId), eq(accountTokens.purpose, record.purpose), ne(accountTokens.id, record.tokenId), isNull(accountTokens.consumedAt)));
      await tx.insert(auditLog).values({ action: `account.${record.purpose}.delivery_succeeded`, entityId: String(record.userId), entityType: 'user' });
      return 'delivered' as const;
    });
    return { status: finalized };
  } catch {
    const nextAttempt = record.attemptCount + 1;
    const failedAt = dependencies.now();
    const [failed] = await db.update(accountDeliveryOutbox).set({ attemptCount: nextAttempt, availableAt: new Date(failedAt.getTime() + accountDeliveryRetrySeconds(nextAttempt) * 1000), deadLetteredAt: nextAttempt >= ACCOUNT_DELIVERY_MAX_ATTEMPTS ? failedAt : null, lastAttemptAt: failedAt, lastErrorCode: 'temporary_delivery_failure', leaseExpiresAt: null, leaseOwner: null }).where(and(eq(accountDeliveryOutbox.id, record.id), eq(accountDeliveryOutbox.leaseOwner, owner), isNull(accountDeliveryOutbox.sentAt))).returning({ id: accountDeliveryOutbox.id });
    if (!failed) return { status: 'lease_lost' as const };
    return { status: nextAttempt >= ACCOUNT_DELIVERY_MAX_ATTEMPTS ? 'dead_lettered' as const : 'retryable' as const };
  }
}

export async function processAccountDeliveryBatch(limit = ACCOUNT_DELIVERY_BATCH_LIMIT) {
  return processDeliveryBatch(deliverNextAccountLink, limit);
}
