import 'server-only';

import { db } from '@/lib/db/drizzle';
import { sql } from 'drizzle-orm';
import { billingAccounts, reconciliationFindings, reconciliationRuns, renewalPreferences, seminarRegistrations, subscriptions } from '@/lib/db/schema';
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
  checkout?: { sessions: { retrieve: (id: string) => Promise<{ id: string; payment_status: string; status: string | null; payment_intent: string | { id: string } | null; amount_total: number | null; currency: string | null }> } };
  paymentIntents?: { retrieve: (id: string) => Promise<{ id: string; status: string; amount_received: number; currency: string }> };
  subscriptionSchedules?: { list: (params: { limit: number; starting_after?: string }) => Promise<{ data: Array<{ id: string; status: string }>; has_more: boolean }> };
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
    const [localBillingAccounts, localSubscriptions, localPreferences] = await Promise.all([
      db.select({ externalCustomerId: billingAccounts.externalCustomerId, profileId: billingAccounts.profileId }).from(billingAccounts),
      db.select({ externalSubscriptionId: subscriptions.externalSubscriptionId, profileId: subscriptions.profileId, status: subscriptions.status }).from(subscriptions),
      db.select({ externalSubscriptionScheduleId: renewalPreferences.externalSubscriptionScheduleId,
        profileId: renewalPreferences.profileId, transitionState: renewalPreferences.transitionState }).from(renewalPreferences),
    ]);
    //SCAN ONLY STRIPE-ONLINE REGISTRATIONS WITH RECORDED CHECKOUT OR PAYMENT REFERENCES.
    const localSeminarRegistrations = await db.select({
      id: seminarRegistrations.id,
      profileId: seminarRegistrations.profileId,
      paymentStatus: seminarRegistrations.paymentStatus,
      stripeCheckoutSessionId: seminarRegistrations.stripeCheckoutSessionId,
      stripePaymentIntentId: seminarRegistrations.stripePaymentIntentId,
      expectedAmountCents: seminarRegistrations.expectedAmountCents,
      currency: seminarRegistrations.currency,
      checkoutStatus: seminarRegistrations.checkoutStatus,
    }).from(seminarRegistrations).where(sql`${seminarRegistrations.paymentMethodCanonicalId} = 'online_stripe' and (${seminarRegistrations.stripeCheckoutSessionId} is not null or ${seminarRegistrations.stripePaymentIntentId} is not null)`);
    const [stripeCustomers, stripeSubscriptions, stripeOpenInvoices, stripeSchedules] = await Promise.all([
      paginate((params) => stripe.customers.list(params)),
      paginate((params) => stripe.subscriptions.list({ ...params, status: 'all' })),
      paginate((params) => stripe.invoices.list({ ...params, status: 'open' })),
      stripe.subscriptionSchedules ? paginate((params) => stripe.subscriptionSchedules!.list(params)) : Promise.resolve([]),
    ]);

    const findings = computeReconciliationFindings(
      { billingAccounts: localBillingAccounts, renewalPreferences: localPreferences, subscriptions: localSubscriptions },
      {
        customers: stripeCustomers,
        openInvoices: stripeOpenInvoices.map((invoice) => ({ attemptCount: invoice.attempt_count, subscription: invoice.parent?.subscription_details?.subscription ?? null })),
        schedules: stripeSchedules,
        subscriptions: stripeSubscriptions,
      },
    );

    //KEEP A FAILED STRIPE LOOKUP FROM PRODUCING A FALSE ALL-CLEAR RESULT.
    const seminarFindings: Array<{ kind: 'seminar_payment_conflict'; profileId: number | null; summary: string; details: Record<string, unknown> }> = [];
    if (localSeminarRegistrations.length && (!stripe.checkout || !stripe.paymentIntents)) {
      throw new Error('Seminar reconciliation requires Stripe Checkout and PaymentIntent retrieval.');
    }
    for (const registration of localSeminarRegistrations) {
      const session = registration.stripeCheckoutSessionId
        ? await stripe.checkout!.sessions.retrieve(registration.stripeCheckoutSessionId)
        : null;
      const intentId = registration.stripePaymentIntentId
        ?? (typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id);
      const intent = intentId ? await stripe.paymentIntents!.retrieve(intentId) : null;
      const isPaid = intent?.status === 'succeeded' || session?.payment_status === 'paid';
      const isUnpaid = Boolean(intent && ['canceled', 'requires_payment_method', 'requires_payment_confirmation'].includes(intent.status));
      const localPaid = ['paid', 'refunded', 'partially_refunded', 'disputed', 'chargeback'].includes(registration.paymentStatus);
      const localAwaitingPayment = ['pending', 'unpaid', 'bank_transfer_pending', 'cash_pending'].includes(registration.paymentStatus);
      const mismatches: string[] = [];
      if (isPaid && localAwaitingPayment) mismatches.push('Stripe reports payment received but the registration is not marked paid');
      if (isUnpaid && localPaid) mismatches.push('The registration records payment but Stripe reports an unsuccessful payment');
      if (isPaid && localPaid && registration.expectedAmountCents !== null) {
        const settledAmount = intent?.amount_received ?? session?.amount_total;
        if (settledAmount !== null && settledAmount !== undefined && settledAmount !== registration.expectedAmountCents) {
          mismatches.push(`Expected ${registration.expectedAmountCents} cents but Stripe reports ${settledAmount} cents`);
        }
      }
      if ((session?.currency ?? intent?.currency)?.toUpperCase() !== registration.currency.toUpperCase() && (session || intent)) {
        mismatches.push('Stripe payment currency differs from the registration currency');
      }
      if (!mismatches.length) continue;
      seminarFindings.push({
        kind: 'seminar_payment_conflict',
        profileId: registration.profileId,
        summary: `Seminar registration #${registration.id}: ${mismatches.join('; ')}.`,
        details: { source: 'daily_seminar_scan', registrationId: registration.id, checkoutSessionId: session?.id ?? null, paymentIntentId: intentId ?? null, mismatches },
      });
    }

    await db.transaction(async (tx) => {
      await tx.delete(reconciliationFindings).where(sql`kind not in ('refund_conflict','missing_refund','dispute','chargeback','seminar_payment_conflict') or (kind = 'seminar_payment_conflict' and details ->> 'source' = 'daily_seminar_scan')`);
      if (findings.length > 0) await tx.insert(reconciliationFindings).values(findings.map(findingRow));
      if (seminarFindings.length > 0) await tx.insert(reconciliationFindings).values(seminarFindings);
      await tx.insert(reconciliationRuns).values({ findingsCount: findings.length + seminarFindings.length, status: 'completed' });
    });
    return { findingsCount: findings.length + seminarFindings.length };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown reconciliation error.';
    await db.insert(reconciliationRuns).values({ errorMessage, findingsCount: 0, status: 'failed' }).catch(() => undefined);
    throw error;
  }
}
