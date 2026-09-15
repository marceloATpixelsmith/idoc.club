import 'server-only';

import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/lib/db/drizzle';
import { billingAccounts, profiles } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { getStripeServerClient } from './stripe-client';

export { getStripeServerClient } from './stripe-client';

// Only the calls this module makes, and only the fields it actually reads back, so tests can
// inject a fake without satisfying the entire real Stripe SDK surface (same pattern as
// lib/payments/checkout.ts's CheckoutStripeClient).
export type PortalStripeClient = {
  billingPortal: {
    configurations: {
      create: (params: Stripe.BillingPortal.ConfigurationCreateParams, options?: Stripe.RequestOptions) => Promise<{ id: string; metadata: Record<string, string> | null }>;
      list: (params: { limit: number }) => Promise<{ data: Array<{ id: string; metadata: Record<string, string> | null }> }>;
    };
    sessions: { create: (params: Stripe.BillingPortal.SessionCreateParams, options?: Stripe.RequestOptions) => Promise<{ url: string }> };
  };
};

// Stripe's list() has no way to filter by feature set, so blindly reusing existing.data[0] could
// attach a session to some other, unrelated Configuration in the account (e.g. one with
// subscription_update enabled) — tag every Configuration this module creates and only ever reuse
// one carrying that tag, never an arbitrary pre-existing one. The tag value is versioned (not a
// bare 'true') so a production account that already has the earlier, broader-scoped v1
// Configuration on file is never matched here — that old Configuration is simply left orphaned in
// Stripe, never reused or mutated, while every new session uses this narrower v2 one.
const PORTAL_CONFIGURATION_METADATA_KEY = 'idoc_membership_portal';
const PORTAL_CONFIGURATION_VERSION = 'v2';
let portalConfigurationPromise: Promise<string> | null = null;

// Bumped whenever the session's own request parameters change shape (e.g. flow_data was added in
// v2) so a retry within the same five-minute idempotency bucket, spanning a deploy, never replays
// against a key whose prior request had different parameters -- Stripe rejects that outright.
const SESSION_IDEMPOTENCY_VERSION = 'v2';

// IDOC prices membership inline (price_data) per Checkout Session rather than from a stable Price
// catalog, and there is only one flat €80/year offering — there is nothing to expose for
// subscription_update (plan-swapping). subscription_cancel and invoice_history were dropped in v2:
// the dashboard's own Renewal Mode control and "Cancel Membership" button are the only place
// recurrence and cancellation are tracked (docs/02 §5.1), and Stripe's own portal cancel button let
// a member bypass that entirely; invoice_history duplicated the dashboard's own Payment History.
// This Configuration now exists for exactly one purpose -- updating the card on file.
async function resolvedConfigurationId(stripe: PortalStripeClient): Promise<string> {
  if (portalConfigurationPromise) return portalConfigurationPromise;
  portalConfigurationPromise = (async () => {
    const existing = await stripe.billingPortal.configurations.list({ limit: 100 });
    const managed = existing.data.find((configuration) => configuration.metadata?.[PORTAL_CONFIGURATION_METADATA_KEY] === PORTAL_CONFIGURATION_VERSION);
    if (managed) return managed.id;
    const created = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Update your IDOC membership payment method' },
    features: {
      payment_method_update: { enabled: true },
    },
    metadata: { [PORTAL_CONFIGURATION_METADATA_KEY]: PORTAL_CONFIGURATION_VERSION },
  }, { idempotencyKey: `idoc-membership-portal-configuration-${PORTAL_CONFIGURATION_VERSION}` });
    return created.id;
  })();
  try {
    return await portalConfigurationPromise;
  } finally {
    portalConfigurationPromise = null;
  }
}

/**
 * Creates a real Stripe-hosted Billing Portal session, scoped to payment-method updates only
 * (docs/04 §7), for the authenticated member's own billing_accounts row. Never creates a Stripe
 * Customer — a member without a billing account has never completed real Stripe Checkout (docs/04
 * §8) and must not be forced into one just to reach this button. The Customer ID is derived
 * server-side from the actor's own profile only; there is no parameter through which a caller could
 * name someone else's Customer. Returns the member to their own My Membership dashboard page,
 * never the generic portal landing, so they never leave the app's own membership-management surface
 * for longer than the actual card-entry step.
 */
export async function createMembershipPortalSession(testStripeClient?: PortalStripeClient): Promise<string> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const stripe = testStripeClient ?? getStripeServerClient();
  const actor = await requireAccountAccess('billing_boundary');
  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, actor.id)).limit(1);
  if (!profile) throw new Error('A member profile is required before managing billing.');
  const [billing] = await db.select({ externalCustomerId: billingAccounts.externalCustomerId })
    .from(billingAccounts).where(eq(billingAccounts.profileId, profile.id)).limit(1);
  if (!billing) throw new Error('No Stripe billing account exists for this member.');
  const configurationId = await resolvedConfigurationId(stripe);
  const returnUrl = `${baseUrlForServer()}/dashboard`;
  const session = await stripe.billingPortal.sessions.create({
    configuration: configurationId,
    customer: billing.externalCustomerId,
    return_url: returnUrl,
    // Jump straight to the add/update card form instead of the portal's own home page (the
    // Configuration has nothing else enabled anyway), and redirect back the instant the card is
    // saved rather than leaving the member on a Stripe-hosted "you're done" screen.
    flow_data: {
      type: 'payment_method_update',
      after_completion: { type: 'redirect', redirect: { return_url: returnUrl } },
    },
  }, {
    // Portal sessions are short-lived. Converge accidental duplicate submissions within a
    // five-minute interaction window while allowing a fresh session after an old one expires.
    // Versioned like the Configuration's own key (docs/04 §7): a retry that lands in the same
    // bucket just after this flow_data change shipped must never replay against a key whose prior
    // request had different parameters, which Stripe rejects outright.
    idempotencyKey: `idoc-membership-portal-session-${SESSION_IDEMPOTENCY_VERSION}-${profile.id}-${Math.floor(Date.now() / 300_000)}`,
  });
  // TEMPORARY diagnostic: a member reported landing on the portal's default overview instead of
  // the payment-method-update flow. Logging only the URL's path -- never its query string, which
  // carries the session's bearer secret (docs/05, docs/09: no secret-bearing values in logs) --
  // plus the flow object Stripe echoed back, to confirm whether flow_data was actually accepted,
  // before removing this once root-caused.
  const urlPathOnly = (() => { try { return new URL(session.url).pathname; } catch { return null; } })();
  console.log('[DIAG-PORTAL]', JSON.stringify({ configurationId, urlPathOnly, flow: (session as unknown as { flow?: unknown }).flow }));
  return session.url;
}

// Only the one call this module makes for reading the card on file, so tests can inject a fake
// without satisfying the entire real Stripe SDK surface (same pattern as the other client types
// above).
export type PaymentMethodStripeClient = {
  paymentMethods: { list: (params: Stripe.PaymentMethodListParams) => Promise<{ data: Array<Pick<Stripe.PaymentMethod, 'card'>> }> };
};

export type PaymentMethodSummary = { brand: string; expMonth: number; expYear: number; last4: string };

/**
 * Reads the member's own most-recently-attached card, for display only -- never the source of
 * truth for what Stripe will actually charge next (that lives entirely on the Stripe side). Returns
 * null when there is no billing account yet or no card is on file. The Stripe Billing Portal's
 * payment-method-update feature sets a newly added card as the default for the customer's open
 * subscription automatically, so "most recent" and "the one Stripe will actually use" agree in
 * every case this function is used for.
 */
export async function getOwnPaymentMethodSummary(testStripeClient?: PaymentMethodStripeClient): Promise<PaymentMethodSummary | null> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const stripe = testStripeClient ?? getStripeServerClient();
  const actor = await requireAccountAccess('billing_boundary');
  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, actor.id)).limit(1);
  if (!profile) return null;
  const [billing] = await db.select({ externalCustomerId: billingAccounts.externalCustomerId })
    .from(billingAccounts).where(eq(billingAccounts.profileId, profile.id)).limit(1);
  if (!billing) return null;
  const methods = await stripe.paymentMethods.list({ customer: billing.externalCustomerId, limit: 1, type: 'card' });
  const card = methods.data[0]?.card;
  if (!card) return null;
  return { brand: card.brand, expMonth: card.exp_month, expYear: card.exp_year, last4: card.last4 };
}

// Only the one call this module makes for cancellation, so tests can inject a fake without
// satisfying the entire real Stripe SDK surface (same pattern as PortalStripeClient above).
export type CancellationStripeClient = {
  subscriptions: { cancel: (id: string) => Promise<{ id: string; status: string }> };
};

/**
 * Cancels a member's Stripe subscription immediately (not at-period-end). No authorization check
 * of its own — this is an internal helper reachable only from already-authorized admin code
 * (lib/membership/status-actions.ts's suspendMembership), matching checkout.ts's private
 * resolveOrCreateBillingAccount. Does not write subscriptions.status itself: that stays the
 * exclusive job of the customer.subscription.deleted webhook this call triggers, preserving the
 * app's rule that every Stripe-triggered local write goes through the webhook, never client-side.
 */
export async function cancelMemberSubscription(subscriptionId: string, testStripeClient?: CancellationStripeClient): Promise<void> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const stripe = testStripeClient ?? getStripeServerClient();
  await stripe.subscriptions.cancel(subscriptionId);
}
