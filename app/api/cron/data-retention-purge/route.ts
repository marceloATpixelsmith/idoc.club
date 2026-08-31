import 'server-only';

import { purgeExpiredAuthRecords } from '@/lib/security/data-retention-purge';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: purgeExpiredAuthRecords,
    reportFailure: () => logError('data_retention_purge_failed', { category: 'operational' }),
    secret: cronSecretForServer(),
  });
}
