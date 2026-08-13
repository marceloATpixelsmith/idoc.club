import 'server-only';

import { processAccountDeliveryBatch } from '@/lib/notifications/account-delivery';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: processAccountDeliveryBatch,
    reportFailure: () => console.error('account_delivery_worker_failed', { category: 'operational' }),
    secret: cronSecretForServer(),
  });
}
