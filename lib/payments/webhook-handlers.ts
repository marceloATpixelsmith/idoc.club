import 'server-only';

import type Stripe from 'stripe';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { billingAccounts, memberships, notificationOutbox, payments, profiles, stripeEvents, subscriptions, users } from '@/lib/db/schema';
import { stripeOneTimeProductIdForServer } from '@/lib/runtime/configuration';
import { MEMBERSHIP_CURRENCY, MEMBERSHIP_FEE_CENTS } from './pricing';
import { gracePeriodEnd, nextValidUntil } from './renewal';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Only the one call this module makes, and only the fields it actually reads back, so tests can
// inject a fake without satisfying the entire real Stripe SDK surface (same pattern as
// lib/payments/checkout.ts's CheckoutStripeClient). The real client structurally satisfies this.
export type WebhookStripeClient = {
  checkout: {
    sessions: {
      listLineItems: (sessionId: string) => Promise<{ data: Array<{ price: { id: string; product: string | { id: string } } | null }> }>;
    };
  };
};

function resolvedCustomerId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

async function resolveProfileId(tx: Transaction, externalCustomerId: string | null): Promise<number | null> {
  if (!externalCustomerId) return null;
  const [billing] = await tx.select({ profileId: billingAccounts.profileId }).from(billingAccounts)
    .where(eq(billingAccounts.externalCustomerId, externalCustomerId)).limit(1);
  return billing?.profileId ?? null;
}

// Locks the selected row for the rest of this transaction so a concurrent webhook event or manual
// payment for the same profile can't read the same pre-update validUntil and derive the same
// one-year extension, silently dropping one of the two renewals.
async function latestMembership(tx: Transaction, profileId: number) {
  const [membership] = await tx.select().from(memberships).where(eq(memberships.profileId, profileId))
    .orderBy(desc(memberships.validUntil)).limit(1).for('update');
  return membership ?? null;
}

async function handleSubscriptionCreated(tx: Transaction, event: Stripe.Event, _stripe: WebhookStripeClient) {
  const subscription = event.data.object as Stripe.Subscription;
  const profileId = await resolveProfileId(tx, resolvedCustomerId(subscription.customer));
  if (!profileId) return;
  const item = subscription.items.data[0];
  await tx.insert(subscriptions).values({
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString().slice(0, 10),
    externalSubscriptionId: subscription.id,
    priceId: item.price.id,
    profileId,
    status: subscription.status,
  }).onConflictDoNothing({ target: subscriptions.externalSubscriptionId });
}

async function handleSubscriptionUpdated(tx: Transaction, event: Stripe.Event, _stripe: WebhookStripeClient) {
  const subscription = event.data.object as Stripe.Subscription;
  const item = subscription.items.data[0];
  await tx.update(subscriptions).set({
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString().slice(0, 10),
    priceId: item.price.id,
    status: subscription.status,
    updatedAt: new Date(),
  }).where(eq(subscriptions.externalSubscriptionId, subscription.id));
}

async function handleSubscriptionDeleted(tx: Transaction, event: Stripe.Event, _stripe: WebhookStripeClient) {
  const subscription = event.data.object as Stripe.Subscription;
  // Recurring billing has ended, but membership access continues through the already-paid
  // valid_until date (docs/02 §3) — nothing in `memberships` changes here.
  await tx.update(subscriptions).set({ status: subscription.status, updatedAt: new Date() })
    .where(eq(subscriptions.externalSubscriptionId, subscription.id));
}

async function handleInvoicePaid(tx: Transaction, event: Stripe.Event, _stripe: WebhookStripeClient) {
  const invoice = event.data.object as Stripe.Invoice;
  const profileId = await resolveProfileId(tx, resolvedCustomerId(invoice.customer));
  if (!profileId) return;
  const paidAt = invoice.status_transitions.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date();
  const [inserted] = await tx.insert(payments).values({
    amountCents: invoice.amount_paid,
    currency: invoice.currency.toUpperCase(),
    externalPaymentId: invoice.id,
    paidAt,
    profileId,
    source: 'stripe_recurring',
  }).onConflictDoNothing({ target: payments.externalPaymentId }).returning({ id: payments.id });
  if (!inserted) return;
  const membership = await latestMembership(tx, profileId);
  const validUntil = nextValidUntil({ currentValidUntil: membership?.validUntil ?? null, paidAt: paidAt.toISOString().slice(0, 10) });
  if (membership) {
    await tx.update(memberships).set({ status: 'active', updatedAt: new Date(), validUntil })
      .where(eq(memberships.id, membership.id));
  } else {
    await tx.insert(memberships).values({
      membershipType: 'standard', profileId, source: 'stripe',
      startsOn: paidAt.toISOString().slice(0, 10), status: 'active', validUntil,
    });
  }
}

async function handleInvoicePaymentFailed(tx: Transaction, event: Stripe.Event, _stripe: WebhookStripeClient) {
  const invoice = event.data.object as Stripe.Invoice;
  const profileId = await resolveProfileId(tx, resolvedCustomerId(invoice.customer));
  if (!profileId) return;
  const membership = await latestMembership(tx, profileId);
  // Stripe's Smart Retries fire a distinct invoice.payment_failed event (distinct event.id, so
  // stripeEvents's dedup doesn't catch it) on every retry attempt for the same unpaid invoice. Only
  // the transition into grace should move validUntil/send a notice — an already-'grace' membership
  // means this is a later retry, not a new failure, and must be a no-op.
  if (!membership || membership.status === 'grace') return;
  // The failed-renewal date is approximated as today (when Stripe reports the failure), which
  // tracks closely with the actual scheduled-renewal attempt date in practice.
  const failedRenewalDate = new Date().toISOString().slice(0, 10);
  const graceEnd = gracePeriodEnd(failedRenewalDate);
  await tx.update(memberships).set({ status: 'grace', updatedAt: new Date(), validUntil: graceEnd })
    .where(eq(memberships.id, membership.id));
  const [contact] = await tx.select({ email: users.email, firstName: profiles.firstName })
    .from(profiles).innerJoin(users, eq(profiles.userId, users.id)).where(eq(profiles.id, profileId)).limit(1);
  await tx.insert(notificationOutbox).values({
    dedupeKey: `membership.payment_failed:${profileId}:${graceEnd}`,
    kind: 'membership.payment_failed',
    payload: { firstName: contact?.firstName, graceEndDate: graceEnd, to: contact?.email },
    profileId,
  }).onConflictDoNothing({ target: notificationOutbox.dedupeKey });
}

// Record/flag only — no entitlement change until a real success or failure event arrives. The
// stripeEvents row processStripeEvent writes for every event is itself the flag; nothing further
// to persist here in Phase 1 (admin surfacing of this state is Phase 3 scope).
async function handleInvoicePaymentActionRequired(_tx: Transaction, _event: Stripe.Event, _stripe: WebhookStripeClient) {
  return undefined;
}

async function handleCheckoutSessionCompleted(tx: Transaction, event: Stripe.Event, stripe: WebhookStripeClient) {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return;
  const profileId = Number(session.metadata?.profileId);
  if (!Number.isInteger(profileId)) return;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId) return;
  // docs/04 §3: grant entitlement only against the expected one-time fee, not whatever amount the
  // session happens to report — this is the "expected Price" check now that pricing is inline
  // price_data rather than a separately managed static Price ID.
  if (session.amount_total !== MEMBERSHIP_FEE_CENTS || session.currency?.toLowerCase() !== MEMBERSHIP_CURRENCY) return;
  // The amount/currency check above can't distinguish this session from any other Checkout Session
  // that happens to total the same €80 — confirm the line item was actually priced against the
  // configured one-time membership Product before granting entitlement.
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
  const price = lineItems.data[0]?.price;
  const productId = price ? (typeof price.product === 'string' ? price.product : price.product.id) : undefined;
  if (!price || productId !== stripeOneTimeProductIdForServer()) return;
  const paidAt = new Date();
  const [inserted] = await tx.insert(payments).values({
    amountCents: session.amount_total,
    currency: session.currency.toUpperCase(),
    externalPaymentId: paymentIntentId,
    paidAt,
    profileId,
    reference: `checkout_session:${session.id};price:${price.id}`,
    source: 'stripe_one_time',
  }).onConflictDoNothing({ target: payments.externalPaymentId }).returning({ id: payments.id });
  if (!inserted) return;
  const membership = await latestMembership(tx, profileId);
  const validUntil = nextValidUntil({ currentValidUntil: membership?.validUntil ?? null, paidAt: paidAt.toISOString().slice(0, 10) });
  if (membership) {
    await tx.update(memberships).set({ status: 'active', updatedAt: new Date(), validUntil })
      .where(eq(memberships.id, membership.id));
  } else {
    await tx.insert(memberships).values({
      membershipType: 'standard', profileId, source: 'stripe',
      startsOn: paidAt.toISOString().slice(0, 10), status: 'active', validUntil,
    });
  }
}

// One-time payments are only ever initiated through Checkout in this design, so
// checkout.session.completed is the authoritative recorder (it carries the server-set profile
// metadata payment_intent.succeeded does not). This handler intentionally takes no action — it
// exists so the required event is acknowledged and its stripeEvents row recorded, satisfying
// docs/04 without double-crediting a payment checkout.session.completed already recorded.
async function handlePaymentIntentSucceeded(_tx: Transaction, _event: Stripe.Event, _stripe: WebhookStripeClient) {
  return undefined;
}

const handlers: Partial<Record<string, (tx: Transaction, event: Stripe.Event, stripe: WebhookStripeClient) => Promise<void>>> = {
  'checkout.session.completed': handleCheckoutSessionCompleted,
  'customer.subscription.created': handleSubscriptionCreated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'invoice.paid': handleInvoicePaid,
  'invoice.payment_action_required': handleInvoicePaymentActionRequired,
  'invoice.payment_failed': handleInvoicePaymentFailed,
  'payment_intent.succeeded': handlePaymentIntentSucceeded,
};

export async function processStripeEvent(event: Stripe.Event, stripe: WebhookStripeClient): Promise<'duplicate' | 'ignored' | 'processed'> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(stripeEvents).values({ eventType: event.type, externalEventId: event.id })
      .onConflictDoNothing({ target: stripeEvents.externalEventId }).returning({ id: stripeEvents.id });
    if (!inserted) return 'duplicate';
    const handler = handlers[event.type];
    if (handler) await handler(tx, event, stripe);
    await tx.update(stripeEvents).set({ processedAt: new Date() }).where(eq(stripeEvents.id, inserted.id));
    return handler ? 'processed' : 'ignored';
  });
}
