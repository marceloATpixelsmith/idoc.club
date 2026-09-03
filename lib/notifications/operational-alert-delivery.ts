import 'server-only';

import { randomUUID } from 'node:crypto';
import { client } from '@/lib/db/drizzle';
import { sendTransactionalEmail } from './mailchimp-transactional';
import { logError } from '@/lib/observability/logger';

// AUTH-OPERATIONS-006: the leased, retrying delivery worker for idoc.operational_alert_outbox,
// mirroring auth-security-delivery.ts's deliverNextAuthSecurityNotification exactly (same
// claim-via-SKIP-LOCKED lease, same exponential-backoff retry, same MAX_ATTEMPTS dead-letter) --
// deliberately the same proven mechanism, not a parallel one, so this inherits the same
// concurrency-safety and durability already established for that table.

const MAX_ATTEMPTS = 6;
const ALERT_DELIVERY_TIMEOUT_MS = 5_000;

export async function deliverNextOperationalAlert(owner: string = randomUUID()) {
  const to = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
  const rows = await client<{
    id: number;
    kind: string;
    subject: string;
    body_html: string;
    attempt_count: number;
  }[]>`
    with candidate as (
      select o.id
      from idoc.operational_alert_outbox o
      where o.sent_at is null and o.dead_lettered_at is null and o.available_at <= now()
        and (o.lease_expires_at is null or o.lease_expires_at < now())
      order by o.available_at, o.id
      for update skip locked
      limit 1
    )
    update idoc.operational_alert_outbox o
    set lease_owner=${owner}, lease_expires_at=now()+interval '5 minutes'
    from candidate
    where o.id=candidate.id
    returning o.id, o.kind, o.subject, o.body_html, o.attempt_count
  `;
  const record = rows[0];
  if (!record) return { status: 'empty' as const };

  // No configured recipient is a configuration state, not a transient delivery failure: retrying it
  // on the same backoff schedule as a real provider outage would eventually dead-letter a perfectly
  // deliverable alert for a reason retrying can never fix. Leave it leased-free and available so it
  // delivers immediately once an operator configures IDOC_ADMIN_NOTIFICATION_EMAIL, without
  // consuming an attempt.
  if (!to) {
    await client`
      update idoc.operational_alert_outbox
      set lease_owner=null, lease_expires_at=null
      where id=${record.id} and lease_owner=${owner}
    `;
    return { status: 'unconfigured' as const };
  }

  try {
    await sendTransactionalEmail(
      { html: record.body_html, messageId: `operational-alert-${record.id}`, subject: record.subject, to },
      { signal: AbortSignal.timeout(ALERT_DELIVERY_TIMEOUT_MS) },
    );
    const done = await client`
      update idoc.operational_alert_outbox
      set sent_at=now(), attempt_count=attempt_count+1, last_attempt_at=now(), last_error_code=null,
          lease_owner=null, lease_expires_at=null
      where id=${record.id} and lease_owner=${owner} and sent_at is null
      returning id
    `;
    return { status: done[0] ? 'delivered' as const : 'lease_lost' as const };
  } catch {
    const attempt = record.attempt_count + 1;
    const delay = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
    const deadLettered = attempt >= MAX_ATTEMPTS;
    await client`
      update idoc.operational_alert_outbox
      set attempt_count=${attempt}, last_attempt_at=now(), last_error_code='temporary_delivery_failure',
          available_at=now()+(${delay} * interval '1 second'),
          dead_lettered_at=${deadLettered ? new Date().toISOString() : null},
          lease_owner=null, lease_expires_at=null
      where id=${record.id} and lease_owner=${owner}
    `;
    if (deadLettered) await logError('operational_alert_dead_lettered', { kind: record.kind });
    return { status: deadLettered ? 'dead_lettered' as const : 'retryable' as const };
  }
}

export async function processOperationalAlertBatch(limit = 25) {
  const summary = { deadLettered: 0, delivered: 0, leaseLost: 0, retryable: 0, unconfigured: 0 };
  for (let index = 0; index < limit; index += 1) {
    const result = await deliverNextOperationalAlert();
    if (result.status === 'empty') break;
    if (result.status === 'unconfigured') { summary.unconfigured += 1; break; }
    if (result.status === 'dead_lettered') summary.deadLettered += 1;
    else if (result.status === 'delivered') summary.delivered += 1;
    else if (result.status === 'lease_lost') summary.leaseLost += 1;
    else summary.retryable += 1;
  }
  return summary;
}
