import 'server-only';

import { runReconciliationScan } from '@/lib/payments/reconciliation-scan';
import { notifySuperAdminsOfScan } from '@/lib/payments/reconciliation-notice';
import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { logError } from '@/lib/observability/logger';

// Resolving a large first scan checks each unlinked customer against Stripe, which can take a few minutes.
export const maxDuration = 300;

export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    // Super Admins are emailed after every scheduled scan (the manual "Run scan now" shows its result on the page instead).
    processBatch: async () => {
      const result = await runReconciliationScan();
      return { ...result, emailed: await notifySuperAdminsOfScan({ ok: true }) };
    },
    reportFailure: async () => {
      logError('reconciliation_scan_failed');
      await notifySuperAdminsOfScan({ error: 'The scan did not complete. Open the page and read the Last run box for the recorded error.', ok: false });
    },
    secret: cronSecretForServer(),
  });
}
