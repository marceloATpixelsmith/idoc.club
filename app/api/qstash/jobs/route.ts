import 'server-only';

import { publishQStashJob, verifyQStashRequest, QSTASH_JOBS, type QStashJob } from '@/lib/background/qstash';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { client } from '@/lib/db/drizzle';
import { GET as accountDelivery } from '@/app/api/cron/account-delivery/route';
import { GET as seminarCancellation } from '@/app/api/cron/seminar-cancellation-resolution/route';
import { GET as renewalScan } from '@/app/api/cron/renewal-notice-scan/route';
import { GET as renewalDelivery } from '@/app/api/cron/renewal-notice-delivery/route';
import { GET as reconciliation } from '@/app/api/cron/reconciliation-scan/route';
import { GET as retention } from '@/app/api/cron/data-retention-purge/route';
import { GET as clockSkew } from '@/app/api/cron/clock-skew-check/route';
import { GET as newsPublishing } from '@/app/api/cron/news-scheduled-publish/route';
import { GET as newRelicHealthCheck } from '@/app/api/cron/new-relic-health-check/route';

const handlers: Record<QStashJob, (request: Request) => Promise<Response>> = {
  'account-delivery': accountDelivery,
  'seminar-cancellation-resolution': seminarCancellation,
  'clock-skew-check': clockSkew,
  'renewal-notice-scan': renewalScan,
  'renewal-notice-delivery-morning': renewalDelivery,
  'reconciliation-scan': reconciliation,
  'data-retention-purge': retention,
  'news-scheduled-publish': newsPublishing,
  'new-relic-weekly-health-check': newRelicHealthCheck,
};

/** Signed QStash only. Reuse the same cron handlers to avoid diverging business behavior. */
export async function POST(request: Request): Promise<Response> {
  let body: string;
  try { body = await request.text(); } catch { return Response.json({ error: 'Invalid request' }, { status: 400 }); }
  if (!await verifyQStashRequest(request, body)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let job: string;
  try { job = (JSON.parse(body) as { job: string }).job; } catch { return Response.json({ error: 'Invalid request' }, { status: 400 }); }
  if (!Object.prototype.hasOwnProperty.call(QSTASH_JOBS, job)) return Response.json({ error: 'Unknown job' }, { status: 400 });
  const secret = cronSecretForServer();
  if (!secret) return Response.json({ error: 'Worker unavailable' }, { status: 503 });
  const response = await handlers[job as QStashJob](new Request(request.url, { method: 'GET', headers: { authorization: `Bearer ${secret}` } }));
  if (job === 'account-delivery' && response.ok) {
    const summary = await response.clone().json() as { retryable?: number; delivered?: number; deadLettered?: number; ineligible?: number; leaseLost?: number; blocked?: number };
    const fullBatch = !summary.blocked && (summary.delivered ?? 0) + (summary.retryable ?? 0) + (summary.deadLettered ?? 0) + (summary.ineligible ?? 0) + (summary.leaseLost ?? 0) >= 20;
    if ((summary.retryable ?? 0) > 0 || fullBatch) {
      // Schedule another attempt only after actual temporary delivery failures.
      // DB availability windows and lease checks prevent premature redelivery.
      // Honor the DB's persisted exponential backoff, including retries beyond 120 seconds.
      const [next] = await client<{ available_at: string | null }[]>`
        select min(available_at) as available_at from (
          select greatest(available_at,coalesce(lease_expires_at,available_at)) as available_at from account_delivery_outbox where sent_at is null and dead_lettered_at is null and terminal_at is null
          union all select greatest(available_at,coalesce(lease_expires_at,available_at)) as available_at from auth_security_notification_outbox where sent_at is null and dead_lettered_at is null
          union all select greatest(available_at,coalesce(lease_expires_at,available_at)) as available_at from operational_alert_outbox where sent_at is null and dead_lettered_at is null
          union all select greatest(available_at,coalesce(lease_expires_at,available_at)) as available_at from notification_outbox where kind='stripe.customer_email_sync' and sent_at is null and dead_lettered_at is null
        ) pending`;
      const earliest = next?.available_at ? new Date(next.available_at).getTime() : Date.now() + 120_000;
      const delay = Number.isFinite(earliest) ? Math.max(15, Math.ceil((earliest - Date.now()) / 1000) + 10) : 120;
      await publishQStashJob('account-delivery', delay);
    }
  }
  if (job === 'seminar-cancellation-resolution' && response.ok) {
    const summary = await response.clone().json() as { failed?: number; processed?: number; blocked?: number };
    // A failed Stripe call should be retried by QStash, not acknowledged as completed.
    if ((summary.failed ?? 0) > 0) return Response.json({ error: 'Cancellation resolution pending retry' }, { status: 503 });
    if (!summary.blocked && (summary.processed ?? 0) >= 25) await publishQStashJob('seminar-cancellation-resolution', 120);
  }
  return response;
}
