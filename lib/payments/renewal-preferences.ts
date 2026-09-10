import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/lib/db/drizzle';
import { auditLog, billingAccounts, memberships, profiles, renewalPreferences, subscriptions } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { OPEN_SUBSCRIPTION_STATUSES } from './pricing';
import { resolveOrCreateBillingAccount, type CheckoutStripeClient } from './checkout';
import { getStripeServerClient } from './stripe-client';

export type RenewalStripeClient = CheckoutStripeClient & {
  subscriptionSchedules: { cancel: (id: string) => Promise<unknown> };
  subscriptions: { update: (id: string, params: Stripe.SubscriptionUpdateParams, options?: Stripe.RequestOptions) => Promise<unknown> };
};

async function ownedState() {
  const actor = await requireAccountAccess('member');
  const [row] = await db.select({ profileId: profiles.id, validUntil: memberships.validUntil })
    .from(profiles).innerJoin(memberships, eq(memberships.profileId, profiles.id))
    .where(eq(profiles.userId, actor.id)).orderBy(desc(memberships.id)).limit(1);
  if (!row) throw new Error('An active membership is required.');
  return { actor, ...row };
}

export async function getOwnRenewalPreference() {
  const actor = await requireAccountAccess('profile');
  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, actor.id)).limit(1);
  if (!profile) return null;
  const [preference] = await db.select().from(renewalPreferences).where(eq(renewalPreferences.profileId, profile.id)).limit(1);
  return preference ?? null;
}

export async function beginAutomaticRenewalSetup(testStripeClient?: RenewalStripeClient): Promise<string> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const stripe = testStripeClient ?? getStripeServerClient();
  const { actor, profileId, validUntil } = await ownedState();
  const customerId = await resolveOrCreateBillingAccount(stripe, actor.id, profileId);
  const [existing] = await db.select().from(renewalPreferences).where(eq(renewalPreferences.profileId, profileId)).limit(1);
  if (existing?.pendingMode === 'recurring' && existing.externalCheckoutSessionId) {
    throw new Error('Automatic renewal setup is already pending.');
  }
  const session = await stripe.checkout.sessions.create({
    cancel_url: `${baseUrlForServer()}/dashboard?billing=cancelled`, customer: customerId,
    metadata: { effectiveOn: validUntil, kind: 'membership_renewal_setup', profileId: String(profileId) },
    mode: 'setup', payment_method_types: ['card'],
    setup_intent_data: { metadata: { effectiveOn: validUntil, kind: 'membership_renewal_setup', profileId: String(profileId) } },
    success_url: `${baseUrlForServer()}/api/stripe/checkout?session_id={CHECKOUT_SESSION_ID}`,
  }, { idempotencyKey: `idoc-renewal-setup-${profileId}-${validUntil}` });
  const sessionId = 'id' in session && typeof session.id === 'string' ? session.id : null;
  if (!session.url || !sessionId) throw new Error('Stripe did not return a complete Checkout Session.');
  await db.insert(renewalPreferences).values({ currentMode: existing?.currentMode ?? 'non_recurring',
    effectiveOn: validUntil, externalCheckoutSessionId: sessionId, pendingMode: 'recurring', profileId,
    transitionState: 'awaiting_setup' }).onConflictDoUpdate({ target: renewalPreferences.profileId,
    set: { effectiveOn: validUntil, externalCheckoutSessionId: sessionId, pendingMode: 'recurring', transitionState: 'awaiting_setup', updatedAt: new Date() } });
  return session.url;
}

export async function disableAutomaticRenewal(testStripeClient?: RenewalStripeClient): Promise<void> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const stripe = testStripeClient ?? getStripeServerClient();
  const { actor, profileId, validUntil } = await ownedState();
  const [subscription] = await db.select().from(subscriptions).where(and(eq(subscriptions.profileId, profileId),
    inArray(subscriptions.status, OPEN_SUBSCRIPTION_STATUSES))).orderBy(desc(subscriptions.id)).limit(1);
  if (!subscription) throw new Error('No automatic renewal subscription exists.');
  await stripe.subscriptions.update(subscription.externalSubscriptionId, { cancel_at_period_end: true },
    { idempotencyKey: `idoc-disable-renewal-${profileId}-${validUntil}` });
  await db.transaction(async (tx) => {
    await tx.insert(renewalPreferences).values({ currentMode: 'recurring', effectiveOn: validUntil,
      pendingMode: 'non_recurring', profileId, transitionState: 'cancel_pending' })
      .onConflictDoUpdate({ target: renewalPreferences.profileId, set: { currentMode: 'recurring', effectiveOn: validUntil,
        pendingMode: 'non_recurring', transitionState: 'cancel_pending', updatedAt: new Date() } });
    await tx.insert(auditLog).values({ action: 'membership.renewal_change_requested', actorId: actor.id,
      afterJson: { effectiveOn: validUntil, pendingMode: 'non_recurring' }, entityId: String(profileId), entityType: 'renewal_preference' });
  });
}

export async function cancelPendingRenewalChange(testStripeClient?: RenewalStripeClient): Promise<void> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const stripe = testStripeClient ?? getStripeServerClient();
  const { actor, profileId } = await ownedState();
  const [preference] = await db.select().from(renewalPreferences).where(eq(renewalPreferences.profileId, profileId)).limit(1);
  if (!preference?.pendingMode) return;
  if (preference.externalSubscriptionScheduleId) await stripe.subscriptionSchedules.cancel(preference.externalSubscriptionScheduleId);
  if (preference.pendingMode === 'non_recurring') {
    const [subscription] = await db.select().from(subscriptions).where(and(eq(subscriptions.profileId, profileId),
      inArray(subscriptions.status, OPEN_SUBSCRIPTION_STATUSES))).orderBy(desc(subscriptions.id)).limit(1);
    if (subscription) await stripe.subscriptions.update(subscription.externalSubscriptionId, { cancel_at_period_end: false },
      { idempotencyKey: `idoc-restore-renewal-${profileId}-${preference.effectiveOn}` });
  }
  await db.transaction(async (tx) => {
    await tx.update(renewalPreferences).set({ effectiveOn: null, expectedChargeCents: null,
      externalCheckoutSessionId: null, externalPaymentMethodId: null, externalSetupIntentId: null,
      externalRecurringPriceId: null, externalSubscriptionScheduleId: null, pendingMode: null,
      transitionState: 'current', updatedAt: new Date() })
      .where(eq(renewalPreferences.profileId, profileId));
    await tx.insert(auditLog).values({ action: 'membership.renewal_change_cancelled', actorId: actor.id,
      entityId: String(profileId), entityType: 'renewal_preference' });
  });
}
