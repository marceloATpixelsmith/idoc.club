import { OPEN_SUBSCRIPTION_STATUSES } from './pricing.ts';

export type ReconciliationFinding =
  | { attemptCount: number; externalSubscriptionId: string; kind: 'repeated_failure'; profileId: number | null }
  | { externalCustomerId: string; externalSubscriptionId: string; kind: 'orphaned_subscription'; stripeStatus: string }
  | { externalCustomerId: string; kind: 'unlinked_customer' }
  | { externalSubscriptionId: string; kind: 'pending_schedule_conflict'; profileId: number; stripeStatus: string }
  | { externalSubscriptionId: string; kind: 'status_conflict'; localStatus: string; profileId: number; stripeStatus: string };

type LocalSnapshot = {
  billingAccounts: Array<{ externalCustomerId: string; profileId: number }>;
  subscriptions: Array<{ externalSubscriptionId: string; profileId: number; status: string }>;
  renewalPreferences?: Array<{ externalSubscriptionScheduleId: string | null; profileId: number; transitionState: string }>;
};

type StripeSnapshot = {
  customers: Array<{ id: string }>;
  openInvoices: Array<{ attemptCount: number; subscription: string | null }>;
  subscriptions: Array<{ customer: string; id: string; status: string }>;
  schedules?: Array<{ id: string; status: string }>;
};

const OPEN_STRIPE_STATUSES = new Set<string>(OPEN_SUBSCRIPTION_STATUSES);

/** `reportLocalMissingInStripe` also reports open local subscriptions that the Stripe list does not contain, as a status_conflict with Stripe
 * status 'missing'. */
export function computeReconciliationFindings(local: LocalSnapshot, stripe: StripeSnapshot, failureThreshold = 2, options: { reportLocalMissingInStripe?: boolean } = {}): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];
  const localSubscriptionsById = new Map(local.subscriptions.map((subscription) => [subscription.externalSubscriptionId, subscription]));
  const localCustomerIds = new Set(local.billingAccounts.map((billing) => billing.externalCustomerId));

  for (const stripeSubscription of stripe.subscriptions) {
    const localSubscription = localSubscriptionsById.get(stripeSubscription.id);
    if (localSubscription) {
      if (localSubscription.status !== stripeSubscription.status) {
        findings.push({
          externalSubscriptionId: stripeSubscription.id, kind: 'status_conflict',
          localStatus: localSubscription.status, profileId: localSubscription.profileId, stripeStatus: stripeSubscription.status,
        });
      }
    } else if (OPEN_STRIPE_STATUSES.has(stripeSubscription.status)) {
      findings.push({
        externalCustomerId: stripeSubscription.customer, externalSubscriptionId: stripeSubscription.id,
        kind: 'orphaned_subscription', stripeStatus: stripeSubscription.status,
      });
    }
  }

  if (options.reportLocalMissingInStripe) {
    const stripeSubscriptionIds = new Set(stripe.subscriptions.map((subscription) => subscription.id));
    for (const localSubscription of local.subscriptions) {
      if (stripeSubscriptionIds.has(localSubscription.externalSubscriptionId) || !OPEN_STRIPE_STATUSES.has(localSubscription.status)) continue;
      findings.push({
        externalSubscriptionId: localSubscription.externalSubscriptionId, kind: 'status_conflict',
        localStatus: localSubscription.status, profileId: localSubscription.profileId, stripeStatus: 'missing',
      });
    }
  }

  for (const customer of stripe.customers) {
    if (!localCustomerIds.has(customer.id)) findings.push({ externalCustomerId: customer.id, kind: 'unlinked_customer' });
  }

  for (const invoice of stripe.openInvoices) {
    if (!invoice.subscription || invoice.attemptCount < failureThreshold) continue;
    const localSubscription = localSubscriptionsById.get(invoice.subscription);
    findings.push({
      attemptCount: invoice.attemptCount, externalSubscriptionId: invoice.subscription,
      kind: 'repeated_failure', profileId: localSubscription?.profileId ?? null,
    });
  }

  const schedules = new Map((stripe.schedules ?? []).map((schedule) => [schedule.id, schedule.status]));
  for (const preference of local.renewalPreferences ?? []) {
    if (preference.transitionState !== 'pending_activation' || !preference.externalSubscriptionScheduleId) continue;
    const status = schedules.get(preference.externalSubscriptionScheduleId);
    if (!status || !['not_started', 'active'].includes(status)) findings.push({
      externalSubscriptionId: preference.externalSubscriptionScheduleId, kind: 'pending_schedule_conflict',
      profileId: preference.profileId, stripeStatus: status ?? 'missing',
    });
  }

  return findings;
}

export function summarizeFinding(finding: ReconciliationFinding): string {
  switch (finding.kind) {
    case 'status_conflict':
      if (finding.stripeStatus === 'missing') return `Local subscription ${finding.externalSubscriptionId} (status '${finding.localStatus}') was not found in Stripe.`;
      return `Local status '${finding.localStatus}' but Stripe reports '${finding.stripeStatus}' for subscription ${finding.externalSubscriptionId}.`;
    case 'orphaned_subscription':
      return `Stripe subscription ${finding.externalSubscriptionId} is '${finding.stripeStatus}' but has no matching local record.`;
    case 'repeated_failure':
      return `Subscription ${finding.externalSubscriptionId} has an open invoice with ${finding.attemptCount} failed payment attempts.`;
    case 'unlinked_customer':
      return `Stripe Customer ${finding.externalCustomerId} has no matching local billing account.`;
    case 'pending_schedule_conflict':
      return `Pending renewal schedule ${finding.externalSubscriptionId} is '${finding.stripeStatus}' in Stripe; inspect before changing local billing state.`;
  }
}

/** A Stripe subscription or customer must have existed this long before it may be acted on automatically: a checkout can create it seconds before its notification writes the local row. */
export const ORPHAN_MIN_AGE_SECONDS = 24 * 60 * 60;
export const CUSTOMER_MIN_AGE_SECONDS = 24 * 60 * 60;
/** An unlinked customer with a charge this recent is treated as a real, active payer and never deleted. */
export const CUSTOMER_RECENT_CHARGE_DAYS = 90;
export const RATIO_BREAKER_MIN_COUNT = 5;
export const RATIO_BREAKER_MAX_SHARE = 0.2;

/** The wrong-database / wrong-Stripe-account guard for a whole class of automatic actions: a handful of exceptions is normal, but when the
 * affected items are a large share of everything compared (an empty or mismatched database next to a full Stripe account, or test and live mixed
 * up) nothing in that class is acted on. `population` includes the affected items themselves. */
export function ratioBreakerTripped(count: number, population: number): boolean {
  return count > RATIO_BREAKER_MIN_COUNT && population > 0 && count / population > RATIO_BREAKER_MAX_SHARE;
}

export type CheckoutOwnershipSession = {
  amount_total: number | null; currency: string | null; customer?: string | { id: string } | null; id: string;
  metadata?: Record<string, string> | null; payment_intent: string | { id: string } | null; payment_status: string;
};
export type CheckoutOwnershipRegistration = {
  customerId: string | null; expectedAmountCents: number | null; id: number; profileId: number | null; seminarId: number;
  stripeCheckoutSessionId: string | null; stripePaymentIntentId: string | null;
};

/** The same ownership and session-to-PaymentIntent checks the checkout notification applies before crediting a seminar registration
 * (webhook-handlers.ts handleSeminarCheckoutSessionCompleted): only a Checkout that provably belongs to this registration may be recorded as its payment. */
export function checkoutBelongsToRegistration(session: CheckoutOwnershipSession, registration: CheckoutOwnershipRegistration): boolean {
  const metadata = session.metadata ?? {};
  const profileRaw = metadata.deliveryOwner === 'staging' ? metadata.seminarProfileId : metadata.profileId;
  const metadataProfileId = profileRaw ? Number(profileRaw) : null;
  if (metadataProfileId !== null && !Number.isInteger(metadataProfileId)) return false;
  const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
  const expected = registration.expectedAmountCents;
  return expected !== null && Boolean(intentId)
    && Number(metadata.registrationId) === registration.id && Number(metadata.seminarId) === registration.seminarId
    && metadataProfileId === registration.profileId && registration.stripeCheckoutSessionId === session.id
    && (registration.stripePaymentIntentId === null || registration.stripePaymentIntentId === intentId)
    && session.amount_total === expected && metadata.amountCents === String(expected) && metadata.currency === 'EUR'
    && session.currency?.toLowerCase() === 'eur' && session.payment_status === 'paid' && customerId === registration.customerId;
}
