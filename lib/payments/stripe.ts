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
      create: (params: Stripe.BillingPortal.ConfigurationCreateParams) => Promise<{ id: string; metadata: Record<string, string> | null }>;
      list: (params: { limit: number }) => Promise<{ data: Array<{ id: string; metadata: Record<string, string> | null }> }>;
    };
    sessions: { create: (params: Stripe.BillingPortal.SessionCreateParams) => Promise<{ url: string }> };
  };
};

// Stripe's list() has no way to filter by feature set, so blindly reusing existing.data[0] could
// attach a session to some other, unrelated Configuration in the account (e.g. one with
// subscription_update enabled) — tag every Configuration this module creates and only ever reuse
// one carrying that tag, never an arbitrary pre-existing one.
const PORTAL_CONFIGURATION_METADATA_KEY = 'idoc_membership_portal';

// IDOC prices membership inline (price_data) per Checkout Session rather than from a stable Price
// catalog, and there is only one flat €80/year offering — there is nothing to expose for
// subscription_update (plan-swapping), so only the features docs/04 §7 actually asks for
// (payment methods, invoices, at-period-end cancellation) are enabled.
async function resolvedConfigurationId(stripe: PortalStripeClient): Promise<string> {
  const existing = await stripe.billingPortal.configurations.list({ limit: 100 });
  const managed = existing.data.find((configuration) => configuration.metadata?.[PORTAL_CONFIGURATION_METADATA_KEY] === 'true');
  if (managed) return managed.id;
  const created = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Manage your IDOC membership payment method' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
    },
    metadata: { [PORTAL_CONFIGURATION_METADATA_KEY]: 'true' },
  });
  return created.id;
}

/**
 * Creates a real Stripe-hosted Billing Portal session for the authenticated member's own
 * billing_accounts row (docs/04 §7). Never creates a Stripe Customer — a member without a billing
 * account has never completed real Stripe Checkout (docs/04 §8) and must not be forced into one
 * just to reach this button. The Customer ID is derived server-side from the actor's own profile
 * only; there is no parameter through which a caller could name someone else's Customer.
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
  const session = await stripe.billingPortal.sessions.create({
    configuration: configurationId,
    customer: billing.externalCustomerId,
    return_url: `${baseUrlForServer()}/dashboard`,
  });
  return session.url;
}
