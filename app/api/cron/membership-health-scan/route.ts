import 'server-only';

import { handleAccountDeliveryCron } from '@/lib/notifications/account-delivery-worker-core';
import { cronSecretForServer } from '@/lib/runtime/configuration';
import { scanMembershipHealthCases } from '@/lib/membership/health-cases';
import { logError } from '@/lib/observability/logger';

export const maxDuration = 300;

// REUSE THE EXISTING AUTHENTICATED VERCEL CRON CONTRACT. THIS SCAN ONLY
// READS PROVIDER EVIDENCE AND PERSISTS INVESTIGATION CASES; IT NEVER
// MODIFIES MEMBERSHIP ENTITLEMENTS, STRIPE PAYMENTS OR EMAIL DELIVERY.
export async function GET(request: Request) {
  return handleAccountDeliveryCron(request, {
    processBatch: scanMembershipHealthCases,
    reportFailure: () => logError('membership_health_scan_failed'),
    secret: cronSecretForServer(),
  });
}
