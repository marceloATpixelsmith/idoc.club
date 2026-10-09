import 'server-only';

import { runNewRelicHealthCheck } from '@/lib/observability/new-relic-health-check';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: runNewRelicHealthCheck,
    reportFailure: () => logError('new_relic_health_check_failed'),
    secret: cronSecretForServer(),
  });
}
