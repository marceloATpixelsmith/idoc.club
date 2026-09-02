import 'server-only';

import { enqueueRenewalNotices } from '@/lib/notifications/renewal-notices';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: enqueueRenewalNotices,
    reportFailure: () => logError('renewal_notice_scan_failed'),
    secret: cronSecretForServer(),
  });
}
