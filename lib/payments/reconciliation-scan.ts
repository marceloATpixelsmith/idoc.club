import 'server-only';

import { db } from '@/lib/db/drizzle';
import { billingAccounts, reconciliationFindings, reconciliationRuns, subscriptions } from '@/lib/db/schema';
import { getStripeServerClient } from './stripe-client';
import { computeReconciliationFindings, summarizeFinding, type ReconciliationFinding } from './reconciliation';

// Only the calls this module makes, and only the fields it actually reads back, so tests can
// inject a fake without satisfying the entire real Stripe SDK surface (same pattern as
// lib/payments/stripe.ts's PortalStripeClient/CancellationStripeClient).
export type ReconciliationStripeClient = {
  customers: { list: (params: { limit: number; starting_after?: string }) => Promise<{ data: Array<{ id: string }>; has_more: boolean }> };
  // Stripe API version 2025-04-30.basil moved an invoice's subscription off the top-level
  // `subscription` field onto `parent.subscription_details.subscription` — this narrows the type
  // to that real shape rather than a flat field, so a future SDK/API-version bump can't silently
  // regress this back to reading a field that no longer exists.
  invoices: { list: (params: { limit: number; starting_after?: string; status: 'open' }) => Promise<{ data: Array<{ attempt_count: number; id: string; parent: { subscription_details: { subscription: string } | null } | null }>; has_more: boolean }> };
  subscriptions: { list: (params: { limit: number; starting_after?: string; status: 'all' }) => Promise<{ data: Array<{ customer: string; id: string; status: string }>; has_more: boolean }> };
};

const PAGE_SIZE = 100;

async function paginate<T extends { id: string }>(list: (params: { limit: number; starting_after?: string }) => Promise<{ data: T[]; has_more: boolean }>): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await list({ limit: PAGE_SIZE, ...(cursor ? { starting_after: cursor } : {}) });
    results.push(...page.data);
    if (!page.has_more) return results;
    cursor = page.data.at(-1)?.id;
    if (!cursor) return results;
  }
}

function findingRow(finding: ReconciliationFinding) {
  return {
    details: finding,
    externalCustomerId: 'externalCustomerId' in finding ? finding.externalCustomerId : null,
    externalSubscriptionId: 'externalSubscriptionId' in finding ? finding.externalSubscriptionId : null,
    kind: finding.kind,
    profileId: 'profileId' in finding ? finding.profileId : null,
    summary: summarizeFinding(finding),
  };
}

/**
 * Compares local subscription/billing state against live Stripe data for the four anomaly
 * categories docs/04 §9 names, and persists the result as the current snapshot (lib/payments/
 * reconciliation.ts's computeReconciliationFindings does the pure comparison; this module is
 * only IO). No auth check of its own — internal, cron-only, same posture as
 * lib/notifications/renewal-notices.ts's enqueueRenewalNotices, which is never reachable from a
 * request boundary a member/admin hits directly. Errors are not swallowed: a best-effort 'failed'
 * reconciliation_runs row is recorded, then the error is rethrown, matching every other cron
 * worker in this codebase — only the cron route's handleAccountDeliveryCron wrapper catches and
 * alerts. reconciliation_findings is left untouched on failure (the last known-good snapshot),
 * rather than wiped to empty, which would read as a false "all clear."
 */
export async function runReconciliationScan(testStripeClient?: ReconciliationStripeClient): Promise<{ findingsCount: number }> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  try {
    // The real Stripe SDK's list responses are typed richer than this narrow interface (e.g.
    // `customer`/`subscription` as `string | Customer | ...` to account for the optional `expand`
    // parameter this module never passes) but are plain ID strings at runtime without it, matching
    // ReconciliationStripeClient exactly — the cast documents that gap rather than hiding a real
    // one. Constructing the real client (which validates STRIPE_SECRET_KEY) stays inside this try
    // block so a misconfigured key is recorded as a failed run like any other scan failure.
    const stripe: ReconciliationStripeClient = testStripeClient ?? (getStripeServerClient() as unknown as ReconciliationStripeClient);
    const [localBillingAccounts, localSubscriptions] = await Promise.all([
      db.select({ externalCustomerId: billingAccounts.externalCustomerId, profileId: billingAccounts.profileId }).from(billingAccounts),
      db.select({ externalSubscriptionId: subscriptions.externalSubscriptionId, profileId: subscriptions.profileId, status: subscriptions.status }).from(subscriptions),
    ]);
    const [stripeCustomers, stripeSubscriptions, stripeOpenInvoices] = await Promise.all([
      paginate((params) => stripe.customers.list(params)),
      paginate((params) => stripe.subscriptions.list({ ...params, status: 'all' })),
      paginate((params) => stripe.invoices.list({ ...params, status: 'open' })),
    ]);

    const findings = computeReconciliationFindings(
      { billingAccounts: localBillingAccounts, subscriptions: localSubscriptions },
      {
        customers: stripeCustomers,
        openInvoices: stripeOpenInvoices.map((invoice) => ({ attemptCount: invoice.attempt_count, subscription: invoice.parent?.subscription_details?.subscription ?? null })),
        subscriptions: stripeSubscriptions,
      },
    );

    await db.transaction(async (tx) => {
      await tx.delete(reconciliationFindings);
      if (findings.length > 0) await tx.insert(reconciliationFindings).values(findings.map(findingRow));
      await tx.insert(reconciliationRuns).values({ findingsCount: findings.length, status: 'completed' });
    });
    return { findingsCount: findings.length };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown reconciliation error.';
    await db.insert(reconciliationRuns).values({ errorMessage, findingsCount: 0, status: 'failed' }).catch(() => undefined);
    throw error;
  }
}
