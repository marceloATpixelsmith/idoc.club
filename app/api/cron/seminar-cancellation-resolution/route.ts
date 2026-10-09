import 'server-only';

import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { logError } from '@/lib/observability/logger';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { processCanceledSeminarPayments } from '@/lib/seminars/cancellation-worker';

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: processCanceledSeminarPayments,
    reportFailure: () => logError('seminar_cancellation_resolution_failed'),
    secret: cronSecretForServer(),
  });
}
