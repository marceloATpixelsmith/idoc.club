import 'server-only';

import { runClockSkewCheck } from '@/lib/observability/clock-skew-check';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: runClockSkewCheck,
    reportFailure: () => logError('clock_skew_check_failed'),
    secret: cronSecretForServer(),
  });
}
