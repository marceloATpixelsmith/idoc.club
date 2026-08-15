import 'server-only';

import type Stripe from 'stripe';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { billingAccounts, memberships, payments, stripeEvents, subscriptions } from '@/lib/db/schema';
import { gracePeriodEnd, nextValidUntil } from './renewal';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

async function latestMembership(tx: Transaction, profileId: number) {
  const [membership] = await tx.select().from(memberships).where(eq(memberships.profileId, profileId))
    .orderBy(desc(memberships.validUntil)).limit(1);
  return membership ?? null;
}

async function handleSubscriptionCreated(tx: Transaction, event: Stripe.Event) {
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

async function handleSubscriptionUpdated(tx: Transaction, event: Stripe.Event) {
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

async function handleSubscriptionDeleted(tx: Transaction, event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  // Recurring billing has ended, but membership access continues through the already-paid
  // valid_until date (docs/02 §3) — nothing in `memberships` changes here.
  await tx.update(subscriptions).set({ status: subscription.status, updatedAt: new Date() })
    .where(eq(subscriptions.externalSubscriptionId, subscription.id));
}

async function handleInvoicePaid(tx: Transaction, event: Stripe.Event) {
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

async function handleInvoicePaymentFailed(tx: Transaction, event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const profileId = await resolveProfileId(tx, resolvedCustomerId(invoice.customer));
  if (!profileId) return;
  const membership = await latestMembership(tx, profileId);
  if (!membership) return;
  // The failed-renewal date is approximated as today (when Stripe reports the failure), which
  // tracks closely with the actual scheduled-renewal attempt date in practice.
  const failedRenewalDate = new Date().toISOString().slice(0, 10);
  await tx.update(memberships).set({ status: 'grace', updatedAt: new Date(), validUntil: gracePeriodEnd(failedRenewalDate) })
    .where(eq(memberships.id, membership.id));
}

// Record/flag only — no entitlement change until a real success or failure event arrives. The
// stripeEvents row processStripeEvent writes for every event is itself the flag; nothing further
// to persist here in Phase 1 (admin surfacing of this state is Phase 3 scope).
async function handleInvoicePaymentActionRequired(_tx: Transaction, _event: Stripe.Event) {
  return undefined;
}

async function handleCheckoutSessionCompleted(tx: Transaction, event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return;
  const profileId = Number(session.metadata?.profileId);
  if (!Number.isInteger(profileId)) return;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId || !session.amount_total || !session.currency) return;
  const paidAt = new Date();
  const [inserted] = await tx.insert(payments).values({
    amountCents: session.amount_total,
    currency: session.currency.toUpperCase(),
    externalPaymentId: paymentIntentId,
    paidAt,
    profileId,
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
async function handlePaymentIntentSucceeded(_tx: Transaction, _event: Stripe.Event) {
  return undefined;
}

const handlers: Partial<Record<string, (tx: Transaction, event: Stripe.Event) => Promise<void>>> = {
  'checkout.session.completed': handleCheckoutSessionCompleted,
  'customer.subscription.created': handleSubscriptionCreated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'invoice.paid': handleInvoicePaid,
  'invoice.payment_action_required': handleInvoicePaymentActionRequired,
  'invoice.payment_failed': handleInvoicePaymentFailed,
  'payment_intent.succeeded': handlePaymentIntentSucceeded,
};

export async function processStripeEvent(event: Stripe.Event): Promise<'duplicate' | 'ignored' | 'processed'> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(stripeEvents).values({ eventType: event.type, externalEventId: event.id })
      .onConflictDoNothing({ target: stripeEvents.externalEventId }).returning({ id: stripeEvents.id });
    if (!inserted) return 'duplicate';
    const handler = handlers[event.type];
    if (handler) await handler(tx, event);
    await tx.update(stripeEvents).set({ processedAt: new Date() }).where(eq(stripeEvents.id, inserted.id));
    return handler ? 'processed' : 'ignored';
  });
}
