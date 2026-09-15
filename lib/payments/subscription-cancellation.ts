import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { subscriptions } from '@/lib/db/schema';
import { OPEN_SUBSCRIPTION_STATUSES } from './pricing';
import { cancelMemberSubscription, type CancellationStripeClient } from './stripe';

async function findOpenSubscription(profileId: number) {
  const [subscription] = await db.select({ externalSubscriptionId: subscriptions.externalSubscriptionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.profileId, profileId), inArray(subscriptions.status, OPEN_SUBSCRIPTION_STATUSES)))
    .orderBy(desc(subscriptions.createdAt)).limit(1);
  return subscription ?? null;
}

// Best-effort: cancels an open Stripe subscription if one exists, never throws. Does not write
// subscriptions.status — the customer.subscription.deleted webhook this triggers owns that write.
// Shared by lib/membership/status-actions.ts's admin suspendMembership and data-access.ts's
// self-service cancelOwnMembership, which need identical behavior. Lives in its own module (rather
// than either caller) because both lib/membership/status-actions.ts and lib/membership/data-access.ts
// already sit on one side of a real circular-import boundary with lib/payments/stripe.ts (stripe.ts
// imports requireAccountAccess from data-access.ts), so this helper can depend on stripe.ts's
// cancelMemberSubscription without either membership module importing the other.
export async function cancelOpenSubscriptionIfAny(profileId: number, testStripeClient?: CancellationStripeClient): Promise<{ stripeCancelError?: string; stripeCancelled: boolean }> {
  const subscription = await findOpenSubscription(profileId);
  if (!subscription) return { stripeCancelled: false };
  try {
    await cancelMemberSubscription(subscription.externalSubscriptionId, testStripeClient);
    return { stripeCancelled: true };
  } catch (error) {
    return { stripeCancelError: error instanceof Error ? error.message : 'Unknown Stripe error.', stripeCancelled: false };
  }
}
