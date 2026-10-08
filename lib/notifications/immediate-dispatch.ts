import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';

/**
 * Kick durable outbox delivery after the HTTP response instead of waiting for polling.
 * Each worker retains its own DB lease, hold, deduplication and retry safeguards.
 * If invoked without an active Next.js request context (e.g. a script or test), the
 * recovery cron remains responsible for the queued work.
 */
export function dispatchQueuedEmailAfterResponse(deliver: () => Promise<unknown>): void {
  if (process.env.NODE_ENV === 'test') return;
  try {
    after(async () => {
      try {
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
