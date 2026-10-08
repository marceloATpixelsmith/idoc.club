import 'server-only';

import { publishQStashJob, verifyQStashRequest, QSTASH_JOBS, type QStashJob } from '@/lib/background/qstash';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { GET as accountDelivery } from '@/app/api/cron/account-delivery/route';
import { GET as seminarCancellation } from '@/app/api/cron/seminar-cancellation-resolution/route';
import { GET as renewalScan } from '@/app/api/cron/renewal-notice-scan/route';
import { GET as renewalDelivery } from '@/app/api/cron/renewal-notice-delivery/route';
import { GET as reconciliation } from '@/app/api/cron/reconciliation-scan/route';
import { GET as retention } from '@/app/api/cron/data-retention-purge/route';
import { GET as clockSkew } from '@/app/api/cron/clock-skew-check/route';
import { GET as newsPublishing } from '@/app/api/cron/news-scheduled-publish/route';

const handlers: Record<QStashJob, (request: Request) => Promise<Response>> = {
  'account-delivery': accountDelivery,
  'seminar-cancellation-resolution': seminarCancellation,
  'clock-skew-check': clockSkew,
  'renewal-notice-scan': renewalScan,
  'renewal-notice-delivery-morning': renewalDelivery,
  'renewal-notice-delivery-afternoon': renewalDelivery,
  'renewal-notice-delivery-evening': renewalDelivery,
  'reconciliation-scan': reconciliation,
  'data-retention-purge': retention,
  'news-scheduled-publish': newsPublishing,
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
    const summary = await response.clone().json() as { retryable?: number };
    if ((summary.retryable ?? 0) > 0) {
      // Schedule another attempt only after actual temporary delivery failures.
      // DB availability windows and lease checks prevent premature redelivery.
      await publishQStashJob('account-delivery', 120);
    }
  }
  return response;
}
