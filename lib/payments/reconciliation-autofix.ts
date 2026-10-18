import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, notificationOutbox, profiles, renewalPreferences, seminarRegistrations, subscriptions, users } from '@/lib/db/schema';
import { communicationHoldFields } from '@/lib/runtime/member-launch-hold';
import { OPEN_SUBSCRIPTION_STATUSES } from './pricing';
import type { ReconciliationFinding } from './reconciliation';

// Automatic fixes the reconciliation scan applies BEFORE it records its findings, so the report that follows lists only what still needs a person.
// Each one is a case with a single correct answer that the Stripe notification handlers would have produced had the notification arrived. Every
// fix is applied conditionally (compare-and-set against what the scan read), audit-logged, and never touches membership entitlement.

/** Statuses the local `subscriptions` table can hold; Stripe's `paused` and anything newer is left as a finding. */
const LOCAL_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired']);
const OPEN = new Set<string>(OPEN_SUBSCRIPTION_STATUSES);

export type StripeSubscriptionDetails = {
  cancel_at_period_end?: boolean;
  id: string;
  items?: { data: Array<{ current_period_end?: number; price?: { id: string } }> };
  status: string;
};

export type AutoFixSummary = { schedulesSynced: number; seminarPaymentsRecorded: number; subscriptionsSynced: number };

/** IDOC's saved copy of a subscription follows Stripe, exactly as customer.subscription.updated/deleted would have set it. Returns the fixed subscription IDs. */
export async function syncSubscriptionStatuses(findings: ReconciliationFinding[], stripeSubscriptions: StripeSubscriptionDetails[]): Promise<string[]> {
  const byId = new Map(stripeSubscriptions.map((subscription) => [subscription.id, subscription]));
  const fixed: string[] = [];
  for (const finding of findings) {
    if (finding.kind !== 'status_conflict') continue;
    const stripe = byId.get(finding.externalSubscriptionId);
    if (!stripe || stripe.status !== finding.stripeStatus || !LOCAL_SUBSCRIPTION_STATUSES.has(stripe.status)) continue;
    try {
      const item = stripe.items?.data?.[0];
      const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString().slice(0, 10) : null;
      // One transaction: the status, the renewal preference and the audit row succeed or fail together, so a later failure can never leave
      // the status fixed (and the finding gone) with the rest missing.
      const synced = await db.transaction(async (tx) => {
        const updated = await tx.update(subscriptions).set({
          status: stripe.status, updatedAt: new Date(),
          ...(stripe.cancel_at_period_end === undefined ? {} : { cancelAtPeriodEnd: stripe.cancel_at_period_end }),
          ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
          ...(item?.price?.id ? { priceId: item.price.id } : {}),
        }).where(and(eq(subscriptions.externalSubscriptionId, finding.externalSubscriptionId), eq(subscriptions.status, finding.localStatus)))
          .returning({ profileId: subscriptions.profileId });
        if (!updated[0]) return false; // changed since the scan read it (a notification arrived): leave it to the next scan
        const profileId = updated[0].profileId;
        if (stripe.status === 'canceled') {
          // As customer.subscription.deleted: recurring billing has ended.
          await tx.insert(renewalPreferences).values({ currentMode: 'non_recurring', profileId })
            .onConflictDoUpdate({ target: renewalPreferences.profileId, set: { currentMode: 'non_recurring', effectiveOn: null, pendingMode: null, transitionState: 'current', updatedAt: new Date() } });
        } else if (stripe.cancel_at_period_end && periodEnd) {
          // As customer.subscription.updated: the member has asked to stop renewing at the end of the period.
          await tx.insert(renewalPreferences).values({ currentMode: 'recurring', effectiveOn: periodEnd, pendingMode: 'non_recurring', profileId, transitionState: 'cancel_pending' })
            .onConflictDoUpdate({ target: renewalPreferences.profileId, set: { currentMode: 'recurring', effectiveOn: periodEnd, pendingMode: 'non_recurring', transitionState: 'cancel_pending', updatedAt: new Date() } });
        }
        await tx.insert(auditLog).values({ action: 'reconciliation.auto_subscription_status_synced', entityType: 'stripe_subscription', entityId: finding.externalSubscriptionId,
          beforeJson: { status: finding.localStatus }, afterJson: { status: stripe.status }, reason: 'Stripe is authoritative for subscription state; IDOC entitlement unchanged.' });
        return true;
      });
      if (synced) fixed.push(finding.externalSubscriptionId);
    } catch { /* leave the finding for a person */ }
  }
  return fixed;
}

/** A renewal change whose Stripe schedule has finished running (completed or released) while IDOC still shows it pending is marked done, as the subscription notification would have. */
export async function syncFinishedSchedules(findings: ReconciliationFinding[]): Promise<string[]> {
  const fixed: string[] = [];
  for (const finding of findings) {
    if (finding.kind !== 'pending_schedule_conflict' || !['completed', 'released'].includes(finding.stripeStatus)) continue;
    try {
      const [open] = await db.select({ id: subscriptions.id }).from(subscriptions)
        .where(and(eq(subscriptions.profileId, finding.profileId), inArray(subscriptions.status, [...OPEN]))).limit(1);
      if (!open) continue; // no running subscription to show for it: a person should look
      const updated = await db.update(renewalPreferences).set({ currentMode: 'recurring', effectiveOn: null, pendingMode: null, transitionState: 'current', updatedAt: new Date() })
        .where(and(eq(renewalPreferences.profileId, finding.profileId), eq(renewalPreferences.externalSubscriptionScheduleId, finding.externalSubscriptionId),
          eq(renewalPreferences.transitionState, 'pending_activation'), eq(renewalPreferences.pendingMode, 'recurring'))).returning({ profileId: renewalPreferences.profileId });
      if (!updated[0]) continue;
      await db.insert(auditLog).values({ action: 'reconciliation.auto_renewal_schedule_completed', entityType: 'renewal_preference', entityId: String(finding.profileId),
        afterJson: { scheduleId: finding.externalSubscriptionId, stripeStatus: finding.stripeStatus }, reason: 'Stripe schedule finished; renewal change marked complete.' });
      fixed.push(finding.externalSubscriptionId);
    } catch { /* leave the finding for a person */ }
  }
  return fixed;
}

export type PaidSeminarRegistration = {
  amountCents: number;
  checkoutSessionId: string | null;
  /** Checkout metadata.deliveryOwner: staging-owned checkouts use the staging confirmation kind, as the notification handler does. */
  deliveryOwner?: string;
  paymentIntentId: string;
  registrationId: number;
};

/** Stripe says a registration's own Checkout was paid in full, in the right amount and currency, while the registration still awaits payment:
 * record the payment and queue the confirmation, as the checkout notification would have. Conditional on the registration still being
 * active and unpaid, and idempotent with that notification (same confirmation dedupe key). Returns whether it was recorded. */
export async function recordPaidSeminarRegistration(paid: PaidSeminarRegistration): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx.update(seminarRegistrations).set({
      checkoutStatus: 'complete', markedPaidByUserId: null, paidAt: new Date(), paymentStatus: 'paid', paymentStatusUpdatedAt: new Date(),
      stripePaymentIntentId: paid.paymentIntentId, updatedAt: new Date(),
    }).where(and(eq(seminarRegistrations.id, paid.registrationId), eq(seminarRegistrations.registrationStatus, 'registered'),
      inArray(seminarRegistrations.paymentStatus, ['pending', 'unpaid']), eq(seminarRegistrations.expectedAmountCents, paid.amountCents)))
      .returning({ profileId: seminarRegistrations.profileId, seminarId: seminarRegistrations.seminarId });
    const registration = updated[0];
    if (!registration) return false;
    await tx.insert(auditLog).values({ action: 'reconciliation.auto_seminar_payment_recorded', entityType: 'seminar_registration', entityId: String(paid.registrationId),
      afterJson: { amountCents: paid.amountCents, checkoutSessionId: paid.checkoutSessionId, paymentIntentId: paid.paymentIntentId },
      reason: 'Stripe confirms the registration\'s own Checkout was paid in full.' });
    const [contact] = await tx.select({ email: users.email, firstName: profiles.firstName }).from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId)).where(eq(profiles.id, registration.profileId)).limit(1);
    if (contact?.email) {
      await tx.insert(notificationOutbox).values({ ...communicationHoldFields(), dedupeKey: `seminar.registration_created:${paid.registrationId}:stripe-paid`,
        kind: paid.deliveryOwner === 'staging' ? 'seminar.staging_registration_created' : 'seminar.registration_created', payload: { amountCents: paid.amountCents, firstName: contact.firstName, paymentConfirmed: true,
          paymentMethod: 'online_stripe', registrationId: paid.registrationId, seminarId: registration.seminarId, to: contact.email },
        profileId: registration.profileId }).onConflictDoNothing({ target: notificationOutbox.dedupeKey });
    }
    return true;
  });
}

/** One audit row per scan summarising what was fixed, so the report can say so. */
export async function recordAutoFixSummary(summary: AutoFixSummary) {
  if (summary.schedulesSynced + summary.seminarPaymentsRecorded + summary.subscriptionsSynced === 0) return;
  await db.insert(auditLog).values({ action: 'reconciliation.auto_fix_summary', entityType: 'reconciliation', entityId: 'scan', afterJson: summary });
}
