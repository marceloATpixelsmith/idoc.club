import 'server-only';
import { assertLiveBillingAllowed } from '@/lib/runtime/member-launch-hold';

import * as Sentry from '@sentry/nextjs';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { deferAdminNotification, notifyCheckoutStartFailure } from '@/lib/notifications/admin-event-alerts';
import { client, db } from '@/lib/db/drizzle';
import { auditLog, billingAccounts, memberships, profiles, subscriptions, users } from '@/lib/db/schema';
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
  // Used only to replace a member's stuck (past-due / incomplete) subscription; see retireStuckSubscriptions.
  invoices?: { voidInvoice: (id: string, params?: Record<string, never>, options?: Stripe.RequestOptions) => Promise<{ id?: string }> };
  subscriptions?: {
    cancel: (id: string, params?: Record<string, never>, options?: Stripe.RequestOptions) => Promise<{ id?: string; status?: string }>;
    retrieve: (id: string, params?: { expand?: string[] }) => Promise<{ id?: string; latest_invoice?: string | { id?: string; status?: string | null } | null; status: string }>;
  };
};

/** Shown when replacing a stuck subscription fails part-way. Every step is checked and retry-safe, so the member can simply try again. */
export const SUBSCRIPTION_REPLACE_FAILED = 'We could not replace your previous subscription. Nothing was charged; please try again, or contact support if it keeps happening.';
const ACTIVE_SUBSCRIPTION_REFUSAL = 'An active or pending subscription already exists for this membership.';
// Only a subscription that is NOT successfully billing may be replaced. An active or trialing one never is.
const REPLACEABLE_LOCAL_STATUSES = ['past_due', 'incomplete'];

async function openSubscriptions(profileId: number): Promise<{ externalSubscriptionId: string; status: string }[]> {
  return db.select({ externalSubscriptionId: subscriptions.externalSubscriptionId, status: subscriptions.status }).from(subscriptions)
    .where(and(eq(subscriptions.profileId, profileId), inArray(subscriptions.status, OPEN_SUBSCRIPTION_STATUSES)));
}

async function markSubscriptionCanceledLocally(profileId: number, actorId: number, subscriptionId: string, previousStatus: string, stripeStatus: string, reason: string) {
  await db.update(subscriptions).set({ status: 'canceled', cancelAtPeriodEnd: false, updatedAt: new Date() })
    .where(and(eq(subscriptions.externalSubscriptionId, subscriptionId), eq(subscriptions.profileId, profileId)));
  await db.insert(auditLog).values({ action: 'billing.stuck_subscription_replaced', actorId, afterJson: { status: 'canceled' },
    beforeJson: { localStatus: previousStatus, stripeStatus }, entityId: subscriptionId, entityType: 'stripe_subscription', reason });
}

/**
 * Replaces a member's stuck subscription so a new one can be created. Safe-by-order: every step is verified against Stripe, idempotent,
 * and ordered so that a failure at any point leaves the member no worse off than before.
 *  1. Re-read the subscription from Stripe (never trust IDOC's saved copy). Active/trialing is never replaced; already-canceled is just synced.
 *  2. Void the still-open renewal invoice first, so nothing can collect on it later (a paid invoice cannot be voided: that aborts, nothing else changed).
 *  3. Cancel the subscription with a stable idempotency key.
 *  4. Only then record it locally. Stripe's customer.subscription.deleted webhook and reconciliation would also converge IDOC's copy.
 * A new Checkout Session creates no subscription until the member pays, so if anything later fails the member simply retries.
 */
async function retireStuckSubscriptions(stripe: CheckoutStripeClient, profileId: number, actorId: number, open: { externalSubscriptionId: string; status: string }[]): Promise<void> {
  if (open.some(({ status }) => !REPLACEABLE_LOCAL_STATUSES.includes(status))) throw new Error(ACTIVE_SUBSCRIPTION_REFUSAL);
  if (!stripe.subscriptions || !stripe.invoices) throw new Error(ACTIVE_SUBSCRIPTION_REFUSAL);
  for (const local of open) {
    try {
      let live;
      try { live = await stripe.subscriptions.retrieve(local.externalSubscriptionId, { expand: ['latest_invoice'] }); } catch (error) {
        if ((error as { code?: string }).code === 'resource_missing') {
          await markSubscriptionCanceledLocally(profileId, actorId, local.externalSubscriptionId, local.status, 'missing', 'The subscription no longer exists in Stripe.');
          continue;
        }
        throw error;
      }
      if (live.status === 'canceled' || live.status === 'incomplete_expired') {
        await markSubscriptionCanceledLocally(profileId, actorId, local.externalSubscriptionId, local.status, live.status, 'Stripe had already ended this subscription; IDOC\'s copy was out of date.');
        continue;
      }
      if (!['past_due', 'unpaid', 'incomplete'].includes(live.status)) throw new Error(ACTIVE_SUBSCRIPTION_REFUSAL);
      const invoice = live.latest_invoice && typeof live.latest_invoice === 'object' ? live.latest_invoice : null;
      if (invoice?.id && invoice.status === 'open') await stripe.invoices.voidInvoice(invoice.id, {}, { idempotencyKey: `idoc-membership-retire-invoice-${invoice.id}` });
      else if (invoice?.status === 'paid') throw new Error(ACTIVE_SUBSCRIPTION_REFUSAL);
      await stripe.subscriptions.cancel(local.externalSubscriptionId, {}, { idempotencyKey: `idoc-membership-retire-subscription-${local.externalSubscriptionId}` });
      await markSubscriptionCanceledLocally(profileId, actorId, local.externalSubscriptionId, local.status, live.status, 'Member started a new subscription checkout while this one was unpaid; the unpaid invoice was voided and the subscription canceled.');
    } catch (error) {
      if (error instanceof Error && error.message === ACTIVE_SUBSCRIPTION_REFUSAL) throw error;
      Sentry.captureException(error, { tags: { payment_operation: 'membership_subscription_replace' }, extra: { profileId, subscriptionId: local.externalSubscriptionId } });
      throw new Error(SUBSCRIPTION_REPLACE_FAILED);
    }
  }
}

// The stable Stripe idempotency key and local profile uniqueness jointly make concurrent first
// checkout attempts converge on one Customer and one billing-account link.
export async function resolveOrCreateBillingAccount(stripe: CheckoutStripeClient, userId: number, profileId: number): Promise<string> {
  assertLiveBillingAllowed('billing.resolveOrCreateBillingAccount');
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
  assertLiveBillingAllowed('billing.createMembershipCheckoutSession');
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const productId = stripeMembershipProductIdForServer();
  const stripe = testStripeClient ?? getStripeServerClient();
  const actor = await requireAccountAccess('billing_boundary');
  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, actor.id)).limit(1);
  if (!profile) throw new Error('A member profile is required before checkout.');
  // A canceled membership has ended by choice and is reversed only by an administrator, so it
  // cannot be renewed by paying again.
  const [latestMembership] = await db.select({ status: memberships.status }).from(memberships)
    .where(eq(memberships.profileId, profile.id)).orderBy(desc(memberships.validUntil)).limit(1);
  if (latestMembership?.status === 'canceled') throw new Error('This membership has been canceled and cannot be renewed.');
  // Suspended and review-held memberships are likewise decided by an administrator, so the payment page must not offer a path around it.
  if (latestMembership?.status === 'suspended' || latestMembership?.status === 'review_required') throw new Error('This membership is on hold and cannot be paid for. Contact support.');
  if (mode === 'subscription') {
    const open = await openSubscriptions(profile.id);
    if (open.length > 0) await retireStuckSubscriptions(stripe, profile.id, actor.id, open);
  }
  const customerId = await resolveOrCreateBillingAccount(stripe, actor.id, profile.id);
  const baseUrl = baseUrlForServer();
  const result = await client.begin(async (sql): Promise<{ error: unknown } | string> => {
    await sql`select pg_advisory_xact_lock(${profile.id})`;
    const [membership] = await sql<{ valid_until: string }[]>`select valid_until from memberships
      where profile_id=${profile.id} order by id desc limit 1 for update`;
    const cycle = membership?.valid_until ?? 'new';
    const [prior] = await sql<{ checkout_url: string | null; external_checkout_session_id: string | null; id: number }[]>`
      select id,external_checkout_session_id,checkout_url from membership_checkout_sessions
      where profile_id=${profile.id} and mode=${mode} and cycle=${cycle} and status in ('creating','open')
      order by attempt desc limit 1 for update`;
    if (prior?.external_checkout_session_id && stripe.checkout.sessions.retrieve) {
      const provider = await stripe.checkout.sessions.retrieve(prior.external_checkout_session_id);
      const payable = provider.status === 'open' && provider.url && (!provider.expires_at || provider.expires_at * 1000 > Date.now());
      if (payable) return provider.url as string;
      const terminal = provider.status === 'expired' ? 'expired' : provider.status === 'complete' ? 'completed' : 'superseded';
      await sql`update membership_checkout_sessions set status=${terminal},updated_at=now() where id=${prior.id}`;
    } else if (prior) {
      await sql`update membership_checkout_sessions set status='superseded',updated_at=now() where id=${prior.id}`;
    }
    const [sequence] = await sql<{ attempt: number }[]>`select coalesce(max(attempt),0)::int + 1 attempt
      from membership_checkout_sessions where profile_id=${profile.id} and mode=${mode} and cycle=${cycle}`;
    const attempt = sequence.attempt;
    const idempotencyKey = `idoc-membership-checkout-${profile.id}-${mode}-${cycle}-${attempt}`;
    const [evidence] = await sql<{ id: number }[]>`insert into membership_checkout_sessions
      (profile_id,mode,cycle,status,idempotency_key,attempt) values
      (${profile.id},${mode},${cycle},'creating',${idempotencyKey},${attempt}) returning id`;
    let session;
    try { session = await stripe.checkout.sessions.create({
    cancel_url: `${baseUrl}/dashboard/membership`,
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
    success_url: `${baseUrl}/api/ui/flash/membership-checkout/${evidence.id}`,
  }, {
    // A browser double-click, retry, refresh, or concurrent request for the same paid-through
    // cycle must resolve to one provider object. Once a verified payment advances valid_until the
    // cycle changes, so a legitimate later renewal receives a new key.
    idempotencyKey,
  });
    } catch (error) {
      await sql`update membership_checkout_sessions set status='failed',updated_at=now() where id=${evidence.id}`;
      return { error };
    }
    if (!session.id || !session.url) {
      await sql`update membership_checkout_sessions set status='failed',updated_at=now() where id=${evidence.id}`;
      return { error: new Error('Stripe did not return a complete Checkout Session.') };
    }
    await sql`update membership_checkout_sessions set external_checkout_session_id=${session.id},
      checkout_url=${session.url},expires_at=${session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null},
      status='open',updated_at=now() where id=${evidence.id}`;
    return session.url;
  });
  if (typeof result === 'string') return result;
  // Stripe could not create the payment page: tell the Billing assignees, then fail the member's request as before.
  deferAdminNotification(() => notifyCheckoutStartFailure({ error: result.error, extra: [['Payment type', mode === 'subscription' ? 'Recurring annual membership' : 'One-time membership fee']], kind: 'membership', profileId: profile.id }));
  throw result.error;
}
