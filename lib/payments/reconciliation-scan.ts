import 'server-only';

import { db } from '@/lib/db/drizzle';
import { eq, inArray, sql } from 'drizzle-orm';
import { auditLog, billingAccounts, reconciliationFindings, reconciliationIgnores, reconciliationRuns, renewalPreferences, seminarRegistrations, subscriptions } from '@/lib/db/schema';
import { getStripeServerClient } from './stripe-client';
import { getRehearsalReadClient } from './rehearsal-read-client';
import { checkoutBelongsToRegistration, computeReconciliationFindings, summarizeFinding, type ReconciliationFinding } from './reconciliation';
import { markMissingSubscriptionsCanceled, newResolutionLog, summarizeResolution, recordPaidSeminarRegistration, resolveOrphanedSubscriptions, resolveRenewalSchedules, resolveUnlinkedCustomers, syncSubscriptionStatuses, type ResolverStripeClient, type StripeMode, type StripeSubscriptionDetails } from './reconciliation-resolver';
import { remediationAllowed } from './remediation-gate';

// Only the calls this module makes, and only the fields it actually reads back, so tests can
// inject a fake without satisfying the entire real Stripe SDK surface (same pattern as
// lib/payments/stripe.ts's PortalStripeClient/CancellationStripeClient).
export type ReconciliationStripeClient = {
  customers: { list: (params: { limit: number; starting_after?: string }) => Promise<{ data: Array<{ created?: number; id: string }>; has_more: boolean }> };
  // Stripe API version 2025-04-30.basil moved an invoice's subscription off the top-level
  // `subscription` field onto `parent.subscription_details.subscription` — this narrows the type
  // to that real shape rather than a flat field, so a future SDK/API-version bump can't silently
  // regress this back to reading a field that no longer exists.
  invoices: { list: (params: { limit: number; starting_after?: string; status: 'open' }) => Promise<{ data: Array<{ attempt_count: number; id: string; parent: { subscription_details: { subscription: string } | null } | null }>; has_more: boolean }> };
  subscriptions: { list: (params: { limit: number; starting_after?: string; status: 'all' }) => Promise<{ data: Array<StripeSubscriptionDetails & { created?: number; customer: string }>; has_more: boolean }> };
  checkout?: { sessions: { retrieve: (id: string) => Promise<{ id: string; payment_status: string; status: string | null; payment_intent: string | { id: string } | null; amount_total: number | null; currency: string | null; customer?: string | { id: string } | null; metadata?: Record<string, string> | null }> } };
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
export async function runReconciliationScan(testStripeClient?: ReconciliationStripeClient, testOptions?: { now?: Date; remediationClient?: ResolverStripeClient; stripeMode?: StripeMode }): Promise<{ findingsCount: number }> {
  if ((testStripeClient || testOptions) && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  try {
    // The real Stripe SDK's list responses are typed richer than this narrow interface (e.g.
    // `customer`/`subscription` as `string | Customer | ...` to account for the optional `expand`
    // parameter this module never passes) but are plain ID strings at runtime without it, matching
    // ReconciliationStripeClient exactly — the cast documents that gap rather than hiding a real
    // one. Constructing the real client (which validates STRIPE_SECRET_KEY) stays inside this try
    // block so a misconfigured key is recorded as a failed run like any other scan failure.
    // TEMPORARY legacy import rehearsal (docs/03 section 12): on staging, with the communications hold on and the restricted
    // live key configured, billing reconciliation reads live Stripe through a read-only facade. Seminar registrations are
    // skipped then, because staging's own seminar payments live in the sandbox, not in live Stripe.
    const rehearsal = testStripeClient ? null : getRehearsalReadClient();
    if (rehearsal) console.warn('[rehearsal_read_mode]', { action: 'reconciliation_scan' });
    const stripe: ReconciliationStripeClient = testStripeClient ?? (rehearsal ?? getStripeServerClient()) as unknown as ReconciliationStripeClient;
    const [localBillingAccounts, localSubscriptions, localPreferences] = await Promise.all([
      db.select({ externalCustomerId: billingAccounts.externalCustomerId, profileId: billingAccounts.profileId }).from(billingAccounts),
      db.select({ externalSubscriptionId: subscriptions.externalSubscriptionId, profileId: subscriptions.profileId, status: subscriptions.status }).from(subscriptions),
      db.select({ externalSubscriptionScheduleId: renewalPreferences.externalSubscriptionScheduleId,
        profileId: renewalPreferences.profileId, transitionState: renewalPreferences.transitionState }).from(renewalPreferences),
    ]);
    // Issues an administrator chose to stop seeing. They are left out of the report AND out of every automatic action; an ignore is dropped below
    // once the issue it covers no longer exists, so a later recurrence is reported afresh.
    const ignoredRows = await db.select({ id: reconciliationIgnores.id, kind: reconciliationIgnores.kind, subjectKey: reconciliationIgnores.subjectKey }).from(reconciliationIgnores);
    const ignoredKeys = new Set(ignoredRows.map((row) => `${row.kind}:${row.subjectKey}`));
    const presentKeys = new Set<string>();
    //SCAN ONLY STRIPE-ONLINE REGISTRATIONS WITH RECORDED CHECKOUT OR PAYMENT REFERENCES.
    const localSeminarRegistrations = rehearsal ? [] : await db.select({
      id: seminarRegistrations.id,
      profileId: seminarRegistrations.profileId,
      paymentStatus: seminarRegistrations.paymentStatus,
      registrationStatus: seminarRegistrations.registrationStatus,
      seminarId: seminarRegistrations.seminarId,
      customerId: billingAccounts.externalCustomerId,
      stripeCheckoutSessionId: seminarRegistrations.stripeCheckoutSessionId,
      stripePaymentIntentId: seminarRegistrations.stripePaymentIntentId,
      expectedAmountCents: seminarRegistrations.expectedAmountCents,
      currency: seminarRegistrations.currency,
      checkoutStatus: seminarRegistrations.checkoutStatus,
    }).from(seminarRegistrations).leftJoin(billingAccounts, eq(billingAccounts.profileId, seminarRegistrations.profileId)).where(sql`${seminarRegistrations.paymentMethodCanonicalId} = 'online_stripe' and (${seminarRegistrations.stripeCheckoutSessionId} is not null or ${seminarRegistrations.stripePaymentIntentId} is not null)`);
    const [stripeCustomers, stripeSubscriptions, stripeOpenInvoices, stripeSchedules] = await Promise.all([
      paginate((params) => stripe.customers.list(params)),
      paginate((params) => stripe.subscriptions.list({ ...params, status: 'all' })),
      paginate((params) => stripe.invoices.list({ ...params, status: 'open' })),
      stripe.subscriptionSchedules ? paginate((params) => stripe.subscriptionSchedules!.list(params)) : Promise.resolve([]),
    ]);

    const rawFindings = computeReconciliationFindings(
      { billingAccounts: localBillingAccounts, renewalPreferences: localPreferences, subscriptions: localSubscriptions },
      {
        customers: stripeCustomers,
        openInvoices: stripeOpenInvoices.map((invoice) => ({ attemptCount: invoice.attempt_count, subscription: invoice.parent?.subscription_details?.subscription ?? null })),
        schedules: stripeSchedules,
        subscriptions: stripeSubscriptions,
      },
      undefined,
      { reportLocalMissingInStripe: true },
    );
    const subjectOf = (finding: ReconciliationFinding): string | null => ('externalSubscriptionId' in finding ? finding.externalSubscriptionId : 'externalCustomerId' in finding ? finding.externalCustomerId : null);
    for (const finding of rawFindings) { const subject = subjectOf(finding); if (subject) presentKeys.add(`${finding.kind}:${subject}`); }
    const findings = rawFindings.filter((finding) => { const subject = subjectOf(finding); return !(subject && ignoredKeys.has(`${finding.kind}:${subject}`)); });

    // Resolve everything with a known answer BEFORE anything is recorded, so the report lists only what needs a person and nobody has to rescan.
    // Changes to IDOC's own database always happen; changes to Stripe happen only where this deployment may write to it and are otherwise
    // SIMULATED (same checks, same effect on the report), so a staging scan shows what a production scan will do.
    const stripeMode: StripeMode = testOptions
      ? (testOptions.stripeMode ?? (testOptions.remediationClient ? 'apply' : 'simulate'))
      : (!rehearsal && remediationAllowed() ? 'apply' : 'simulate');
    const log = newResolutionLog(stripeMode);
    const actionClient = (testOptions?.remediationClient ?? stripe) as unknown as ResolverStripeClient;
    const nowSeconds = Math.floor((testOptions?.now ?? new Date()).getTime() / 1000);
    const resolvedSubscriptions = new Set<string>();
    const resolvedCustomers = new Set<string>();
    const resolvedSchedules = new Set<string>();
    for (const id of await syncSubscriptionStatuses(findings, stripeSubscriptions, log)) resolvedSubscriptions.add(id);
    for (const id of await markMissingSubscriptionsCanceled(findings, localSubscriptions.length, log)) resolvedSubscriptions.add(id);
    for (const id of await resolveRenewalSchedules(findings, log)) resolvedSchedules.add(id);
    for (const id of await resolveOrphanedSubscriptions(findings, stripeSubscriptions, localSubscriptions.length, actionClient, nowSeconds, log)) resolvedSubscriptions.add(id);
    // A customer whose orphaned subscription was just dealt with is left for the next scan rather than deleted in the same breath.
    const customersWithOrphans = new Set(findings.flatMap((finding) => (finding.kind === 'orphaned_subscription' ? [finding.externalCustomerId] : [])));
    for (const id of await resolveUnlinkedCustomers(findings, stripeCustomers, localBillingAccounts.length, customersWithOrphans, actionClient, nowSeconds, log)) resolvedCustomers.add(id);
    for (let index = findings.length - 1; index >= 0; index -= 1) {
      const finding = findings[index];
      const resolved = (finding.kind === 'status_conflict' || finding.kind === 'orphaned_subscription') ? resolvedSubscriptions.has(finding.externalSubscriptionId)
        : finding.kind === 'pending_schedule_conflict' ? resolvedSchedules.has(finding.externalSubscriptionId)
          : finding.kind === 'unlinked_customer' ? resolvedCustomers.has(finding.externalCustomerId) : false;
      if (resolved) findings.splice(index, 1);
    }

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
      presentKeys.add(`seminar_payment_conflict:registration:${registration.id}`);
      // The one fully predictable case: Stripe confirms this registration's own Checkout was paid in full, in the expected amount and currency, and
      // nothing else is wrong. Record it (as the checkout notification would have) instead of reporting it.
      const settled = intent?.amount_received ?? session?.amount_total;
      if (mismatches.length === 1 && isPaid && localAwaitingPayment && registration.registrationStatus === 'registered' && intentId
        && registration.expectedAmountCents !== null && settled === registration.expectedAmountCents && intent?.status === 'succeeded'
        && session && checkoutBelongsToRegistration(session, registration)) {
        try {
          if (await recordPaidSeminarRegistration({ amountCents: registration.expectedAmountCents, checkoutSessionId: session?.id ?? null,
            deliveryOwner: session?.metadata?.deliveryOwner, paymentIntentId: intentId, registrationId: registration.id }, log)) continue;
        } catch { /* fall through: report it for a person */ }
      }
      if (ignoredKeys.has(`seminar_payment_conflict:registration:${registration.id}`)) continue;
      seminarFindings.push({
        kind: 'seminar_payment_conflict',
        profileId: registration.profileId,
        summary: `Seminar registration #${registration.id}: ${mismatches.join('; ')}.`,
        details: { source: 'daily_seminar_scan', registrationId: registration.id, checkoutSessionId: session?.id ?? null, paymentIntentId: intentId ?? null, mismatches },
      });
    }

    await db.transaction(async (tx) => {
      // Rehearsal skips the seminar checks, so it must also leave the previous seminar findings in place.
      await tx.delete(reconciliationFindings).where(rehearsal
        ? sql`kind not in ('refund_conflict','missing_refund','dispute','chargeback','seminar_payment_conflict') and not (kind in ('status_conflict','pending_schedule_conflict') and details ->> 'kind' is null)`
        : sql`(kind not in ('refund_conflict','missing_refund','dispute','chargeback','seminar_payment_conflict') and not (kind in ('status_conflict','pending_schedule_conflict') and details ->> 'kind' is null)) or (kind = 'seminar_payment_conflict' and details ->> 'source' = 'daily_seminar_scan')`);
      // Findings raised by Stripe notifications (no `kind` inside details) stay until a person closes them; the scan replaces only its own.
      // Refunds and disputes are kept as seminar evidence only when they belong to a real seminar registration. Earlier versions also
      // recorded refunds Stripe sent for unrelated payments (for example the legacy site) as "Seminar" conflicts; remove those.
      await tx.delete(reconciliationFindings).where(sql`kind in ('refund_conflict','dispute','chargeback') and details ->> 'paymentIntentId' is not null and not exists (select 1 from ${seminarRegistrations} where ${seminarRegistrations.stripePaymentIntentId} = details ->> 'paymentIntentId')`);
      if (findings.length > 0) await tx.insert(reconciliationFindings).values(findings.map(findingRow));
      if (seminarFindings.length > 0) await tx.insert(reconciliationFindings).values(seminarFindings);
      // An ignore whose issue no longer exists is dropped, so a later recurrence is reported afresh. Seminar ignores are only judged when the seminar check ran.
      const expired = ignoredRows.filter((row) => !presentKeys.has(`${row.kind}:${row.subjectKey}`) && (!rehearsal || row.kind !== 'seminar_payment_conflict')).map((row) => row.id);
      if (expired.length > 0) await tx.delete(reconciliationIgnores).where(inArray(reconciliationIgnores.id, expired));
      await tx.insert(reconciliationRuns).values({ findingsCount: findings.length + seminarFindings.length, status: 'completed' });
      await tx.insert(auditLog).values({ action: 'reconciliation.scan_resolution_summary', entityType: 'reconciliation', entityId: 'scan', afterJson: summarizeResolution(log) });
    });
    return { findingsCount: findings.length + seminarFindings.length };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown reconciliation error.';
    await db.insert(reconciliationRuns).values({ errorMessage, findingsCount: 0, status: 'failed' }).catch(() => undefined);
    throw error;
  }
}
