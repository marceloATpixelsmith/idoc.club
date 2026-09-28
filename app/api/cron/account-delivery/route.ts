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
      // Security-notification and operational-alert delivery are each intentionally isolated so a
      // failure in either secondary queue cannot turn an otherwise successful account-delivery run
      // into 500.
      try {
        await processAuthSecurityNotificationBatch();
      } catch (error) {
        Sentry.captureException(error);
        await logError('auth_security_delivery_worker_failed');
      }
      try {
        await processOperationalAlertBatch();
      } catch (error) {
        Sentry.captureException(error);
        await logError('operational_alert_delivery_worker_failed');
      }
      try {
        await processStripeCustomerEmailSyncBatch();
      } catch (error) {
        Sentry.captureException(error);
        await logError('account_delivery_worker_failed');
      }
      return account;
    },
    reportFailure: () => logError('account_delivery_worker_failed'),
    secret: cronSecretForServer(),
  });
}
