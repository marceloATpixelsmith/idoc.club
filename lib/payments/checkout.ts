import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/lib/db/drizzle';
import { billingAccounts, memberships, profiles, subscriptions, users } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { baseUrlForServer, stripeMembershipProductIdForServer } from '@/lib/runtime/configuration';
import { MEMBERSHIP_CURRENCY, MEMBERSHIP_FEE_CENTS, OPEN_SUBSCRIPTION_STATUSES } from './pricing';
import { getStripeServerClient } from './stripe-client';

export type CheckoutMode = 'payment' | 'subscription';

// Only the two calls this module makes, and only the fields it actually reads back, so tests can
// inject a fake without satisfying the entire (very large) real Stripe SDK surface. The real
// client structurally satisfies this already.
export type CheckoutStripeClient = {
  checkout: { sessions: { create: (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => Promise<{ url: string | null }> } };
  customers: { create: (params: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions) => Promise<{ id: string }> };
};

async function hasOpenSubscription(profileId: number): Promise<boolean> {
  const [existing] = await db.select({ id: subscriptions.id }).from(subscriptions)
    .where(and(eq(subscriptions.profileId, profileId), inArray(subscriptions.status, OPEN_SUBSCRIPTION_STATUSES))).limit(1);
  return Boolean(existing);
}

// The stable Stripe idempotency key and local profile uniqueness jointly make concurrent first
// checkout attempts converge on one Customer and one billing-account link.
export async function resolveOrCreateBillingAccount(stripe: CheckoutStripeClient, userId: number, profileId: number): Promise<string> {
  const [existing] = await db.select({ externalCustomerId: billingAccounts.externalCustomerId })
    .from(billingAccounts).where(eq(billingAccounts.profileId, profileId)).limit(1);
  if (existing) return existing.externalCustomerId;
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const customer = await stripe.customers.create({ email: user?.email, metadata: { profileId: String(profileId) } },
    { idempotencyKey: `idoc-membership-customer-${profileId}` });
  const [inserted] = await db.insert(billingAccounts).values({ externalCustomerId: customer.id, profileId })
    .onConflictDoNothing({ target: billingAccounts.profileId }).returning({ externalCustomerId: billingAccounts.externalCustomerId });
  if (inserted) return inserted.externalCustomerId;
  const [committed] = await db.select({ externalCustomerId: billingAccounts.externalCustomerId })
    .from(billingAccounts).where(eq(billingAccounts.profileId, profileId)).limit(1);
  return committed.externalCustomerId;
}

/**
 * Creates a real €80 Checkout Session for the authenticated member: subscription mode for
 * auto-renewal, payment mode for the one-time path (docs/02 §5.1, docs/04 §3). Entitlement is
 * granted only once the corresponding webhook event is verified (processStripeEvent), never from
 * this session's creation or the browser's return redirect. `testStripeClient` lets tests verify
 * this function's own logic (billing-account resolution, correct parameters) against real
 * PostgreSQL without a live Stripe API call.
 */
export async function createMembershipCheckoutSession(mode: CheckoutMode, testStripeClient?: CheckoutStripeClient): Promise<string> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const productId = stripeMembershipProductIdForServer();
  const stripe = testStripeClient ?? getStripeServerClient();
  const actor = await requireAccountAccess('billing_boundary');
  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, actor.id)).limit(1);
  if (!profile) throw new Error('A member profile is required before checkout.');
  if (mode === 'subscription' && await hasOpenSubscription(profile.id)) {
    throw new Error('An active or pending subscription already exists for this membership.');
  }
  const [membership] = await db.select({ validUntil: memberships.validUntil }).from(memberships)
    .where(eq(memberships.profileId, profile.id)).orderBy(desc(memberships.id)).limit(1);
  const customerId = await resolveOrCreateBillingAccount(stripe, actor.id, profile.id);
  const baseUrl = baseUrlForServer();

  const session = await stripe.checkout.sessions.create({
    cancel_url: `${baseUrl}/pricing`,
    customer: customerId,
    line_items: [{
      price_data: {
        currency: MEMBERSHIP_CURRENCY,
        product: productId,
        recurring: mode === 'subscription' ? { interval: 'year' } : undefined,
        unit_amount: MEMBERSHIP_FEE_CENTS,
      },
      quantity: 1,
    }],
    metadata: { mode, profileId: String(profile.id) },
    mode,
    subscription_data: mode === 'subscription' ? { metadata: { kind: 'idoc_membership', profileId: String(profile.id) } } : undefined,
    success_url: `${baseUrl}/api/stripe/checkout?session_id={CHECKOUT_SESSION_ID}`,
  }, {
    // A browser double-click, retry, refresh, or concurrent request for the same paid-through
    // cycle must resolve to one provider object. Once a verified payment advances valid_until the
    // cycle changes, so a legitimate later renewal receives a new key.
    idempotencyKey: `idoc-membership-checkout-${profile.id}-${mode}-${membership?.validUntil ?? 'new'}`,
  });
  if (!session.url) throw new Error('Stripe did not return a Checkout Session URL.');
  return session.url;
}
