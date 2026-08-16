import 'server-only';

import { enqueueRenewalNotices } from '@/lib/notifications/renewal-notices';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: enqueueRenewalNotices,
    reportFailure: () => console.error('renewal_notice_scan_failed', { category: 'operational' }),
    secret: cronSecretForServer(),
  });
}
