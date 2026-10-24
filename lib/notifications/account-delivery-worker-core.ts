import { timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';

export const ACCOUNT_DELIVERY_BATCH_LIMIT = 20;
export const ACCOUNT_DELIVERY_LEASE_MS = 5 * 60 * 1000;
type DeliveryResult = { status: 'blocked' | 'dead_lettered' | 'delivered' | 'empty' | 'ineligible' | 'lease_lost' | 'retryable' };

export async function processDeliveryBatch(deliver: () => Promise<DeliveryResult>, limit = ACCOUNT_DELIVERY_BATCH_LIMIT) {
  const summary = { blocked: 0, deadLettered: 0, delivered: 0, ineligible: 0, leaseLost: 0, retryable: 0 };
  for (let processed = 0; processed < limit; processed += 1) {
    const result = await deliver();
    if (result.status === 'empty') break;
    if (result.status === 'blocked') { summary.blocked += 1; break; }
    if (result.status === 'dead_lettered') summary.deadLettered += 1;
    else if (result.status === 'delivered') summary.delivered += 1;
    else if (result.status === 'ineligible') summary.ineligible += 1;
    else if (result.status === 'lease_lost') summary.leaseLost += 1;
    else summary.retryable += 1;
  }
  return summary;
}

function authorized(request: Request, secret: string | undefined) {
  const authorization = request.headers.get('authorization');
  if (!secret || !authorization?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function handleAccountDeliveryCron(request: Request, dependencies: {
  processBatch: () => Promise<Record<string, number>>;
  reportFailure: () => void | Promise<void>;
  secret: string | undefined;
}) {
  if (!authorized(request, dependencies.secret)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const summary = await dependencies.processBatch();
    await recordCronRun(request, 200);
    return Response.json(summary);
  } catch (error) {
    if (typeof Sentry.captureException === 'function') Sentry.captureException(error);
    await dependencies.reportFailure();
    await recordCronRun(request, 500);
    return Response.json({ error: 'Worker failed' }, { status: 500 });
  }
}

/** Records an authorized direct Vercel Cron run (/api/cron/<job>) for the cron monitor. Loaded on demand and only when a database is
 * configured, so unit tests and database-free callers never touch it; QStash-driven runs are recorded by the QStash route instead. */
async function recordCronRun(request: Request, status: number): Promise<void> {
  try {
    if (!process.env.POSTGRES_URL && !process.env.TEST_DATABASE_URL) return;
    const { vercelCronJobFromUrl } = await import('@/lib/observability/job-run-record-core');
    const job = vercelCronJobFromUrl(request.url);
    if (!job) return;
    const { recordJobRun } = await import('@/lib/observability/job-run-record');
    await recordJobRun(job, 'vercel', status);
  } catch {
    // Best-effort only.
  }
}
