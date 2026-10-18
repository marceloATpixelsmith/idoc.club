import 'server-only';

import { runReconciliationScan } from '@/lib/payments/reconciliation-scan';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';

// Resolving a large first scan checks each unlinked customer against Stripe, which can take a few minutes.
export const maxDuration = 300;

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: runReconciliationScan,
    reportFailure: () => logError('reconciliation_scan_failed'),
    secret: cronSecretForServer(),
  });
}
