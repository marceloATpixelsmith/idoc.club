import 'server-only';

import { processRenewalNoticeBatch } from '@/lib/notifications/renewal-notices';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: processRenewalNoticeBatch,
    reportFailure: () => console.error('renewal_notice_delivery_failed', { category: 'operational' }),
    secret: cronSecretForServer(),
  });
}
