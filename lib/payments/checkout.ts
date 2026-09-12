import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { client, db } from '@/lib/db/drizzle';
import { billingAccounts, profiles, subscriptions, users } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { baseUrlForServer, stripeMembershipProductIdForServer } from '@/lib/runtime/configuration';
import { MEMBERSHIP_CURRENCY, MEMBERSHIP_FEE_CENTS, OPEN_SUBSCRIPTION_STATUSES } from './pricing';
import { getStripeServerClient } from './stripe-client';

export type CheckoutMode = 'payment' | 'subscription';

// Only the two calls this module makes, and only the fields it actually reads back, so tests can
// inject a fake without satisfying the entire (very large) real Stripe SDK surface. The real
// client structurally satisfies this already.
export type CheckoutStripeClient = {
  checkout: { sessions: { retrieve?: (id: string) => Promise<{ id?: string; status?: string | null; expires_at?: number | null; url: string | null }>; create: (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => Promise<{ expires_at?: number | null; id?: string; status?: string | null; url: string | null }> } };
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
  const customerId = await resolveOrCreateBillingAccount(stripe, actor.id, profile.id);
  const baseUrl = baseUrlForServer();
  const result = await client.begin(async (sql): Promise<{ error: unknown } | string> => {
    await sql`select pg_advisory_xact_lock(${profile.id})`;
    const [membership] = await sql<{ valid_until: string }[]>`select valid_until from idoc.memberships
      where profile_id=${profile.id} order by id desc limit 1 for update`;
    const cycle = membership?.valid_until ?? 'new';
    const [prior] = await sql<{ checkout_url: string | null; external_checkout_session_id: string | null; id: number }[]>`
      select id,external_checkout_session_id,checkout_url from idoc.membership_checkout_sessions
      where profile_id=${profile.id} and mode=${mode} and cycle=${cycle} and status in ('creating','open')
      order by attempt desc limit 1 for update`;
    if (prior?.external_checkout_session_id && stripe.checkout.sessions.retrieve) {
      const provider = await stripe.checkout.sessions.retrieve(prior.external_checkout_session_id);
      const payable = provider.status === 'open' && provider.url && (!provider.expires_at || provider.expires_at * 1000 > Date.now());
      if (payable) return provider.url as string;
      const terminal = provider.status === 'expired' ? 'expired' : provider.status === 'complete' ? 'completed' : 'superseded';
      await sql`update idoc.membership_checkout_sessions set status=${terminal},updated_at=now() where id=${prior.id}`;
    } else if (prior) {
      await sql`update idoc.membership_checkout_sessions set status='superseded',updated_at=now() where id=${prior.id}`;
    }
    const [sequence] = await sql<{ attempt: number }[]>`select coalesce(max(attempt),0)::int + 1 attempt
      from idoc.membership_checkout_sessions where profile_id=${profile.id} and mode=${mode} and cycle=${cycle}`;
    const attempt = sequence.attempt;
    const idempotencyKey = `idoc-membership-checkout-${profile.id}-${mode}-${cycle}-${attempt}`;
    const [evidence] = await sql<{ id: number }[]>`insert into idoc.membership_checkout_sessions
      (profile_id,mode,cycle,status,idempotency_key,attempt) values
      (${profile.id},${mode},${cycle},'creating',${idempotencyKey},${attempt}) returning id`;
    let session;
    try { session = await stripe.checkout.sessions.create({
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
    idempotencyKey,
  });
    } catch (error) {
      await sql`update idoc.membership_checkout_sessions set status='failed',updated_at=now() where id=${evidence.id}`;
      return { error };
    }
    if (!session.id || !session.url) {
      await sql`update idoc.membership_checkout_sessions set status='failed',updated_at=now() where id=${evidence.id}`;
      return { error: new Error('Stripe did not return a complete Checkout Session.') };
    }
    await sql`update idoc.membership_checkout_sessions set external_checkout_session_id=${session.id},
      checkout_url=${session.url},expires_at=${session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null},
      status='open',updated_at=now() where id=${evidence.id}`;
    return session.url;
  });
  if (typeof result === 'string') return result;
  throw result.error;
}
