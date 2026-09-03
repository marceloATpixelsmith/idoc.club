import 'server-only';

import { processAccountDeliveryBatch } from '@/lib/notifications/account-delivery';
import { processAuthSecurityNotificationBatch } from '@/lib/notifications/auth-security-delivery';
import { processOperationalAlertBatch } from '@/lib/notifications/operational-alert-delivery';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: async () => {
      const account = await processAccountDeliveryBatch();
      // Security-notification and operational-alert delivery are each intentionally isolated so a
      // failure in either secondary queue cannot turn an otherwise successful account-delivery run
      // into 500.
      try {
        await processAuthSecurityNotificationBatch();
      } catch {
        await logError('auth_security_delivery_worker_failed');
      }
      try {
        await processOperationalAlertBatch();
      } catch {
        await logError('operational_alert_delivery_worker_failed');
      }
      return account;
    },
    reportFailure: () => logError('account_delivery_worker_failed'),
    secret: cronSecretForServer(),
  });
}
