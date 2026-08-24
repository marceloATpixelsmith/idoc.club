import 'server-only';

import { processAccountDeliveryBatch } from '@/lib/notifications/account-delivery';
import { processAuthSecurityNotificationBatch } from '@/lib/notifications/auth-security-delivery';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: async () => {
      const account = await processAccountDeliveryBatch();
      const authSecurity = await processAuthSecurityNotificationBatch();
      return {
        accountDeadLettered: account.deadLettered,
        accountDelivered: account.delivered,
        accountIneligible: account.ineligible,
        accountLeaseLost: account.leaseLost,
        accountRetryable: account.retryable,
        authSecurityDeadLettered: authSecurity.deadLettered,
        authSecurityDelivered: authSecurity.delivered,
        authSecurityLeaseLost: authSecurity.leaseLost,
        authSecurityRetryable: authSecurity.retryable,
      };
    },
    reportFailure: () => console.error('account_delivery_worker_failed', { category: 'operational' }),
    secret: cronSecretForServer(),
  });
}
