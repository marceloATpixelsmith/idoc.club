import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { processAccountDeliveryBatch } from '@/lib/notifications/account-delivery';
import { processAuthSecurityNotificationBatch } from '@/lib/notifications/auth-security-delivery';
import { processOperationalAlertBatch } from '@/lib/notifications/operational-alert-delivery';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';
import { processStripeCustomerEmailSyncBatch } from '@/lib/payments/customer-email';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: async () => {
      const account = await processAccountDeliveryBatch();
      let retryable = account.retryable;
      // Security-notification and operational-alert delivery are each intentionally isolated so a
      // failure in either secondary queue cannot turn an otherwise successful account-delivery run
      // into 500.
      try {
        const security = await processAuthSecurityNotificationBatch();
        retryable += security.retryable;
      } catch (error) {
        Sentry.captureException(error);
        await logError('auth_security_delivery_worker_failed');
        retryable += 1;
      }
      try {
        const operational = await processOperationalAlertBatch();
        retryable += operational.retryable;
      } catch (error) {
        Sentry.captureException(error);
        await logError('operational_alert_delivery_worker_failed');
        retryable += 1;
      }
      try {
        const stripeEmailSync = await processStripeCustomerEmailSyncBatch();
        retryable += stripeEmailSync.retried;
      } catch (error) {
        Sentry.captureException(error);
        await logError('account_delivery_worker_failed');
        retryable += 1;
      }
      return { ...account, retryable };
    },
    reportFailure: () => logError('account_delivery_worker_failed'),
    secret: cronSecretForServer(),
  });
}
