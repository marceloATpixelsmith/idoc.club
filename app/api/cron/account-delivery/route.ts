import 'server-only';

import { processAccountDeliveryBatch } from '@/lib/notifications/account-delivery';
import { processAuthSecurityNotificationBatch } from '@/lib/notifications/auth-security-delivery';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: async () => {
      const account = await processAccountDeliveryBatch();
      // Security-notification delivery is intentionally isolated so a failure in that
      // secondary queue cannot turn an otherwise successful account-delivery run into 500.
      try {
        await processAuthSecurityNotificationBatch();
      } catch {
        console.error('auth_security_delivery_worker_failed', { category: 'operational' });
      }
      return account;
    },
    reportFailure: () => console.error('account_delivery_worker_failed', { category: 'operational' }),
    secret: cronSecretForServer(),
  });
}
