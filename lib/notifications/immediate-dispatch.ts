import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';
import { publishQStashJob, qstashConfigured, type QStashJob } from '@/lib/background/qstash';

/**
 * Kick durable outbox delivery after the HTTP response instead of waiting for polling.
 * Each worker retains its own DB lease, hold, deduplication and retry safeguards.
 * If invoked without an active Next.js request context (e.g. a script or test), the
 * recovery cron remains responsible for the queued work.
 */
export function dispatchQueuedEmailAfterResponse(deliver: () => Promise<unknown>, job?: QStashJob): void {
  if (process.env.NODE_ENV === 'test') return;
  try {
    after(async () => {
      try {
        if (job && qstashConfigured()) {
          try {
            await publishQStashJob(job);
            return;
          } catch (error) {
            Sentry.captureException(error);
            // Fall through to immediate local delivery when queue publication fails.
          }
        }
        await deliver();
      } catch (error) {
        Sentry.captureException(error);
        // The durable outbox row remains eligible for the recovery cron.
      }
    });
  } catch {
    // Next.js after() needs a request context. The persistent outbox is the fallback.
  }
}
