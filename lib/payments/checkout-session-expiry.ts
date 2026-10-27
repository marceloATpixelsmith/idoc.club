import 'server-only';

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { membershipCheckoutSessions, renewalPreferences } from '@/lib/db/schema';
import { assertLiveBillingAllowed } from '@/lib/runtime/member-launch-hold';
import { getStripeServerClient } from './stripe-client';
import type { CancellationStripeClient } from './stripe';

/** The one Stripe call this module makes, so tests can inject a fake (same pattern as CancellationStripeClient). */
export type CheckoutExpiryStripeClient = Pick<CancellationStripeClient, 'checkout'>;

/**
 * A Checkout Session stays payable at Stripe for up to 24 hours, so one opened before a cancellation, suspension or review hold could
 * still be completed afterwards. The webhook handlers already refuse to let such a payment (or renewal Setup) reverse the decision;
 * this ends the sessions at the source so the member cannot even pay for one. Best effort and never throws: the membership-level
 * change is the authority and must not depend on a network call. Rows are marked expired only after Stripe confirms; a session
 * Stripe could not expire stays open and the webhook guard still protects the membership.
 */
export async function expireOpenCheckoutSessionsIfAny(profileId: number, testStripeClient?: CheckoutExpiryStripeClient): Promise<{ checkoutExpiryFailed: number; checkoutSessionsExpired: number }> {
  try {
    const [payable, setup] = await Promise.all([
      db.select({ externalId: membershipCheckoutSessions.externalCheckoutSessionId, id: membershipCheckoutSessions.id })
        .from(membershipCheckoutSessions).where(and(
          eq(membershipCheckoutSessions.profileId, profileId), inArray(membershipCheckoutSessions.status, ['creating', 'open']),
          isNotNull(membershipCheckoutSessions.externalCheckoutSessionId),
        )),
      db.select({ externalId: renewalPreferences.externalCheckoutSessionId }).from(renewalPreferences).where(and(
        eq(renewalPreferences.profileId, profileId), eq(renewalPreferences.transitionState, 'awaiting_setup'), isNotNull(renewalPreferences.externalCheckoutSessionId),
      )),
    ]);
    if (payable.length === 0 && setup.length === 0) return { checkoutExpiryFailed: 0, checkoutSessionsExpired: 0 };
    assertLiveBillingAllowed('billing.expireOpenCheckoutSessions');
    if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
    const stripe = (testStripeClient ?? getStripeServerClient()) as CheckoutExpiryStripeClient;
    const expire = stripe.checkout?.sessions?.expire;
    if (!expire) return { checkoutExpiryFailed: 0, checkoutSessionsExpired: 0 };
    let expired = 0;
    let failed = 0;
    for (const session of payable) {
      try {
        await expire.call(stripe.checkout!.sessions, session.externalId!);
        await db.update(membershipCheckoutSessions).set({ status: 'expired', updatedAt: new Date() }).where(eq(membershipCheckoutSessions.id, session.id));
        expired += 1;
      } catch { failed += 1; /* already expired or completed at Stripe, or Stripe unreachable: the webhook guard still protects the membership, and the caller reports the count so an administrator can retry */ }
    }
    for (const session of setup) {
      try {
        await expire.call(stripe.checkout!.sessions, session.externalId!);
        await db.update(renewalPreferences).set({ transitionState: 'failed', updatedAt: new Date() }).where(eq(renewalPreferences.externalCheckoutSessionId, session.externalId!));
        expired += 1;
      } catch { failed += 1; }
    }
    return { checkoutExpiryFailed: failed, checkoutSessionsExpired: expired };
  } catch {
    return { checkoutExpiryFailed: 0, checkoutSessionsExpired: 0 };
  }
}
