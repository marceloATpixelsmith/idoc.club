import 'server-only';

import { reconcileMarketingPreferences } from '@/lib/membership/marketing-preference';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: reconcileMarketingPreferences,
    reportFailure: () => logError('marketing_preference_sync_failed'),
    secret: cronSecretForServer(),
  });
}
