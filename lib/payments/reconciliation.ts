import { OPEN_SUBSCRIPTION_STATUSES } from './pricing.ts';

export type ReconciliationFinding =
  | { attemptCount: number; externalSubscriptionId: string; kind: 'repeated_failure'; profileId: number | null }
  | { externalCustomerId: string; externalSubscriptionId: string; kind: 'orphaned_subscription'; stripeStatus: string }
  | { externalCustomerId: string; kind: 'unlinked_customer' }
  | { externalSubscriptionId: string; kind: 'status_conflict'; localStatus: string; profileId: number; stripeStatus: string };

type LocalSnapshot = {
  billingAccounts: Array<{ externalCustomerId: string; profileId: number }>;
  subscriptions: Array<{ externalSubscriptionId: string; profileId: number; status: string }>;
};

type StripeSnapshot = {
  customers: Array<{ id: string }>;
  openInvoices: Array<{ attemptCount: number; subscription: string | null }>;
  subscriptions: Array<{ customer: string; id: string; status: string }>;
};

const OPEN_STRIPE_STATUSES = new Set<string>(OPEN_SUBSCRIPTION_STATUSES);

export function computeReconciliationFindings(local: LocalSnapshot, stripe: StripeSnapshot, failureThreshold = 2): ReconciliationFinding[] {
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

  return findings;
}

export function summarizeFinding(finding: ReconciliationFinding): string {
  switch (finding.kind) {
    case 'status_conflict':
      return `Local status '${finding.localStatus}' but Stripe reports '${finding.stripeStatus}' for subscription ${finding.externalSubscriptionId}.`;
    case 'orphaned_subscription':
      return `Stripe subscription ${finding.externalSubscriptionId} is '${finding.stripeStatus}' but has no matching local record.`;
    case 'repeated_failure':
      return `Subscription ${finding.externalSubscriptionId} has an open invoice with ${finding.attemptCount} failed payment attempts.`;
    case 'unlinked_customer':
      return `Stripe Customer ${finding.externalCustomerId} has no matching local billing account.`;
  }
}
