import 'server-only';

import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { runEmailDeliveryWatch } from '@/lib/notifications/email-delivery-watch';
import { runMemberJourneyWatch } from '@/lib/notifications/member-journey-watch';
import { processOperationalAlertBatch } from '@/lib/notifications/operational-alert-delivery';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';

// Every five minutes, separately from the 15-minute account-delivery safety net: a sign-in code is only useful for fifteen minutes,
// so an alert about one that has not arrived must not wait for the next sweep.
export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: async () => {
      const watch = await runEmailDeliveryWatch();
      // KEEP EXISTING EMAIL DELIVERY ALERTS FLOWING EVEN IF THE NEW SCAN FAILS.
      let journey = { alerted: false, concerns: 0 };
      try { journey = await runMemberJourneyWatch(); }
      catch { await logError('member_journey_watch_failed'); }
      // Deliver what the watch queued in this same run (the queue's own worker also retries anything that fails).
      const delivery = await processOperationalAlertBatch();
      return { ...watch, journeyConcerns: journey.concerns, journeyDigestQueued: journey.alerted ? 1 : 0, alertsRetryable: delivery.retryable };
    },
    reportFailure: () => logError('email_delivery_watch_failed'),
    secret: cronSecretForServer(),
  });
}
