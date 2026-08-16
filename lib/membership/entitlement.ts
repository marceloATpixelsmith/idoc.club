import { OPEN_SUBSCRIPTION_STATUSES } from '../payments/pricing.ts';

export type EntitlementRecord = {
  status: string;
  validUntil: string;
};

export function isEntitled(record: EntitlementRecord | null, today: string): boolean {
  if (!record || record.validUntil < today) return false;
  return ['active', 'grace', 'complimentary', 'canceled'].includes(record.status);
}

export const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  active: 'Active', canceled: 'Canceled', complimentary: 'Complimentary',
  expired: 'Expired', grace: 'Payment grace period', review_required: 'Under review', suspended: 'Suspended',
};

export type SubscriptionSummary = { cancelAtPeriodEnd: boolean; status: string } | null;
export type RenewalMode = 'auto_renew' | 'cancels_at_period_end' | 'manual' | 'none';

/** Distinguishes a member auto-renewing via an open Stripe subscription from a manual/one-time payer. */
export function renewalMode(subscription: SubscriptionSummary, entitlement: EntitlementRecord | null): RenewalMode {
  if (subscription && OPEN_SUBSCRIPTION_STATUSES.includes(subscription.status as typeof OPEN_SUBSCRIPTION_STATUSES[number])) {
    return subscription.cancelAtPeriodEnd ? 'cancels_at_period_end' : 'auto_renew';
  }
  return entitlement ? 'manual' : 'none';
}
