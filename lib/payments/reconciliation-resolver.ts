import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, billingAccounts, notificationOutbox, profiles, renewalPreferences, seminarRegistrations, subscriptions, users } from '@/lib/db/schema';
import { communicationHoldFields } from '@/lib/runtime/member-launch-hold';
import { OPEN_SUBSCRIPTION_STATUSES } from './pricing';
import { CUSTOMER_MIN_AGE_SECONDS, CUSTOMER_RECENT_CHARGE_DAYS, ORPHAN_MIN_AGE_SECONDS, ratioBreakerTripped, type ReconciliationFinding } from './reconciliation';

// The reconciliation scan's resolver: every case where the correct action is known is carried out BEFORE the findings are recorded, so the report that
// follows lists only what a person must investigate and nobody has to rescan.
//
// Two kinds of action, with one rule each:
//  - Changes to IDOC's own database always happen (staging and production alike), conditionally (compare-and-set against what the scan read), audited.
//  - Changes to Stripe (cancel an orphaned subscription, delete an unlinked customer) happen only where `stripeMode` is 'apply' (the production
//    deployment against a Stripe account it may write to). Everywhere else they are SIMULATED: the same checks run, the item leaves the report
//    exactly as it would have, and the action is logged as simulated. A later production scan therefore does what the staging scan showed.
// Nothing here changes membership entitlement.

export type StripeMode = 'apply' | 'simulate';
export type ActionKind = 'subscription_status_synced' | 'subscription_marked_canceled' | 'renewal_change_completed' | 'renewal_change_reverted'
  | 'seminar_payment_recorded' | 'orphan_subscription_canceled' | 'unlinked_customer_deleted';
export type ActionOutcome = 'applied' | 'simulated' | 'failed';
export type ResolutionAction = { id: string; kind: ActionKind; outcome: ActionOutcome; summary: string };
export type PausedResolution = { count: number; kind: ActionKind; reason: string };
export type ResolutionLog = { actions: ResolutionAction[]; paused: PausedResolution[]; stripeMode: StripeMode };

export function newResolutionLog(stripeMode: StripeMode): ResolutionLog {
  return { actions: [], paused: [], stripeMode };
}

/** Statuses the local `subscriptions` table can hold; Stripe's `paused` and anything newer is left as a finding. */
const LOCAL_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired']);
const OPEN = new Set<string>(OPEN_SUBSCRIPTION_STATUSES);

export type StripeSubscriptionDetails = {
  cancel_at_period_end?: boolean;
  created?: number;
  customer?: string;
  id: string;
  items?: { data: Array<{ current_period_end?: number; price?: { id: string } }> };
  status: string;
};

/** What the Stripe-side actions need. Reads always work; `cancel` and `del` are only ever called in 'apply' mode. */
export type ResolverStripeClient = {
  charges?: { list: (params: { created?: { gte: number }; customer: string; limit: number }) => Promise<{ data: Array<{ id: string }> }> };
  customers?: { del?: (id: string) => Promise<unknown> };
  invoices?: { list: (params: { customer?: string; limit: number; starting_after?: string; status: 'open' }) => Promise<{ data: Array<{ id: string }> }> };
  subscriptions: {
    cancel?: (id: string, params?: Record<string, never>, options?: { idempotencyKey: string }) => Promise<unknown>;
    list?: (params: { customer?: string; limit: number; starting_after?: string; status: 'all' }) => Promise<{ data: Array<{ id: string; status: string }>; has_more?: boolean }>;
    retrieve?: (id: string) => Promise<{ id: string; status: string }>;
  };
};

const note = (log: ResolutionLog, action: ResolutionAction) => { log.actions.push(action); };

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// IDOC database actions
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** IDOC's saved copy of a subscription follows Stripe, as customer.subscription.updated/deleted would have set it. Returns the resolved subscription IDs. */
export async function syncSubscriptionStatuses(findings: ReconciliationFinding[], stripeSubscriptions: StripeSubscriptionDetails[], log: ResolutionLog): Promise<Set<string>> {
  const byId = new Map(stripeSubscriptions.map((subscription) => [subscription.id, subscription]));
  const resolved = new Set<string>();
  for (const finding of findings) {
    if (finding.kind !== 'status_conflict') continue;
    const stripe = byId.get(finding.externalSubscriptionId);
    if (!stripe || stripe.status !== finding.stripeStatus || !LOCAL_SUBSCRIPTION_STATUSES.has(stripe.status)) continue;
    try {
      const item = stripe.items?.data?.[0];
      const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString().slice(0, 10) : null;
      // One transaction: the status, the renewal preference and the audit row succeed or fail together.
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
          await tx.insert(renewalPreferences).values({ currentMode: 'non_recurring', profileId })
            .onConflictDoUpdate({ target: renewalPreferences.profileId, set: { currentMode: 'non_recurring', effectiveOn: null, pendingMode: null, transitionState: 'current', updatedAt: new Date() } });
        } else if (stripe.cancel_at_period_end && periodEnd) {
          await tx.insert(renewalPreferences).values({ currentMode: 'recurring', effectiveOn: periodEnd, pendingMode: 'non_recurring', profileId, transitionState: 'cancel_pending' })
            .onConflictDoUpdate({ target: renewalPreferences.profileId, set: { currentMode: 'recurring', effectiveOn: periodEnd, pendingMode: 'non_recurring', transitionState: 'cancel_pending', updatedAt: new Date() } });
        }
        await tx.insert(auditLog).values({ action: 'reconciliation.auto_subscription_status_synced', entityType: 'stripe_subscription', entityId: finding.externalSubscriptionId,
          beforeJson: { status: finding.localStatus }, afterJson: { status: stripe.status }, reason: 'Stripe is authoritative for subscription state; IDOC entitlement unchanged.' });
        return true;
      });
      if (!synced) continue;
      resolved.add(finding.externalSubscriptionId);
      note(log, { id: finding.externalSubscriptionId, kind: 'subscription_status_synced', outcome: 'applied', summary: `IDOC status '${finding.localStatus}' updated to Stripe's '${stripe.status}'.` });
    } catch {
      note(log, { id: finding.externalSubscriptionId, kind: 'subscription_status_synced', outcome: 'failed', summary: 'The update failed and will be retried by the next scan.' });
    }
  }
  return resolved;
}

/** A subscription IDOC treats as open that Stripe does not have: billing has ended, so IDOC's copy becomes cancelled (entitlement unchanged).
 * Skipped, and reported, when it affects a large share of local subscriptions: that looks like the wrong Stripe account, not ended subscriptions. */
export async function markMissingSubscriptionsCanceled(findings: ReconciliationFinding[], localSubscriptionCount: number, log: ResolutionLog): Promise<Set<string>> {
  const resolved = new Set<string>();
  const missing = findings.flatMap((finding) => (finding.kind === 'status_conflict' && finding.stripeStatus === 'missing' ? [finding] : []));
  if (missing.length === 0) return resolved;
  if (ratioBreakerTripped(missing.length, localSubscriptionCount)) {
    log.paused.push({ count: missing.length, kind: 'subscription_marked_canceled', reason: `${missing.length} of ${localSubscriptionCount} subscriptions in IDOC are missing from the Stripe account being checked; that looks like the wrong Stripe account, so none were marked cancelled.` });
    return resolved;
  }
  for (const finding of missing) {
    try {
      const done = await db.transaction(async (tx) => {
        const updated = await tx.update(subscriptions).set({ status: 'canceled', updatedAt: new Date() })
          .where(and(eq(subscriptions.externalSubscriptionId, finding.externalSubscriptionId), eq(subscriptions.status, finding.localStatus)))
          .returning({ profileId: subscriptions.profileId });
        if (!updated[0]) return false;
        await tx.insert(renewalPreferences).values({ currentMode: 'non_recurring', profileId: updated[0].profileId })
          .onConflictDoUpdate({ target: renewalPreferences.profileId, set: { currentMode: 'non_recurring', effectiveOn: null, pendingMode: null, transitionState: 'current', updatedAt: new Date() } });
        await tx.insert(auditLog).values({ action: 'reconciliation.auto_subscription_marked_canceled', entityType: 'stripe_subscription', entityId: finding.externalSubscriptionId,
          beforeJson: { status: finding.localStatus }, afterJson: { status: 'canceled' }, reason: 'The subscription does not exist in Stripe; billing has ended. IDOC entitlement unchanged.' });
        return true;
      });
      if (!done) continue;
      resolved.add(finding.externalSubscriptionId);
      note(log, { id: finding.externalSubscriptionId, kind: 'subscription_marked_canceled', outcome: 'applied', summary: `Not found in Stripe; IDOC status '${finding.localStatus}' set to cancelled.` });
    } catch {
      note(log, { id: finding.externalSubscriptionId, kind: 'subscription_marked_canceled', outcome: 'failed', summary: 'The update failed and will be retried by the next scan.' });
    }
  }
  return resolved;
}

/** A renewal change waiting on a Stripe schedule is brought in line with what the schedule actually did: finished (with a running subscription) means
 * complete; cancelled or gone means it will never happen, so the waiting change is dropped and the member's current renewal option stands. */
export async function resolveRenewalSchedules(findings: ReconciliationFinding[], log: ResolutionLog): Promise<Set<string>> {
  const resolved = new Set<string>();
  for (const finding of findings) {
    if (finding.kind !== 'pending_schedule_conflict') continue;
    const finished = ['completed', 'released'].includes(finding.stripeStatus);
    const gone = ['canceled', 'missing'].includes(finding.stripeStatus);
    if (!finished && !gone) continue;
    try {
      if (finished) {
        const [open] = await db.select({ id: subscriptions.id }).from(subscriptions)
          .where(and(eq(subscriptions.profileId, finding.profileId), inArray(subscriptions.status, [...OPEN]))).limit(1);
        if (!open) continue; // no running subscription to show for it: a person should look
      }
      const changes = finished
        ? { currentMode: 'recurring', effectiveOn: null, pendingMode: null, transitionState: 'current', updatedAt: new Date() }
        : { effectiveOn: null, pendingMode: null, transitionState: 'current', updatedAt: new Date() };
      const updated = await db.update(renewalPreferences).set(changes)
        .where(and(eq(renewalPreferences.profileId, finding.profileId), eq(renewalPreferences.externalSubscriptionScheduleId, finding.externalSubscriptionId),
          eq(renewalPreferences.transitionState, 'pending_activation'), eq(renewalPreferences.pendingMode, 'recurring'))).returning({ profileId: renewalPreferences.profileId });
      if (!updated[0]) continue;
      await db.insert(auditLog).values({ action: finished ? 'reconciliation.auto_renewal_schedule_completed' : 'reconciliation.auto_renewal_schedule_reverted', entityType: 'renewal_preference',
        entityId: String(finding.profileId), afterJson: { scheduleId: finding.externalSubscriptionId, stripeStatus: finding.stripeStatus },
        reason: finished ? 'Stripe schedule finished; renewal change marked complete.' : 'Stripe schedule is cancelled or gone; the waiting renewal change was dropped. The member was not notified.' });
      resolved.add(finding.externalSubscriptionId);
      note(log, { id: finding.externalSubscriptionId, kind: finished ? 'renewal_change_completed' : 'renewal_change_reverted', outcome: 'applied',
        summary: finished ? 'Stripe schedule finished; renewal change marked complete.' : `Stripe schedule is ${finding.stripeStatus}; the waiting renewal change was dropped (the member was not notified).` });
    } catch {
      note(log, { id: finding.externalSubscriptionId, kind: finished ? 'renewal_change_completed' : 'renewal_change_reverted', outcome: 'failed', summary: 'The update failed and will be retried by the next scan.' });
    }
  }
  return resolved;
}

export type PaidSeminarRegistration = {
  amountCents: number;
  checkoutSessionId: string | null;
  /** Checkout metadata.deliveryOwner: staging-owned checkouts use the staging confirmation kind, as the notification handler does. */
  deliveryOwner?: string;
  paymentIntentId: string;
  registrationId: number;
};

/** Stripe says a registration's own Checkout was paid in full, in the right amount and currency, while the registration still awaits payment: record the
 * payment and queue the confirmation, as the checkout notification would have. Conditional on the registration still being active and unpaid, and idempotent with
 * that notification (same confirmation dedupe key). Returns whether it was recorded. */
export async function recordPaidSeminarRegistration(paid: PaidSeminarRegistration, log: ResolutionLog): Promise<boolean> {
  const recorded = await db.transaction(async (tx) => {
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
  if (recorded) note(log, { id: `registration #${paid.registrationId}`, kind: 'seminar_payment_recorded', outcome: 'applied', summary: `Stripe confirms the Checkout was paid in full (${(paid.amountCents / 100).toFixed(2)} EUR); payment recorded and confirmation queued.` });
  return recorded;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Stripe actions (applied only where stripeMode is 'apply', simulated everywhere else)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** An open Stripe subscription IDOC has no record of is cancelled, so it cannot charge someone who was removed. It must be a day old, still open in
 * Stripe and still unknown to IDOC at the moment of action, and the class is skipped when orphans are a large share of everything compared. */
export async function resolveOrphanedSubscriptions(findings: ReconciliationFinding[], stripeSubscriptions: StripeSubscriptionDetails[], localSubscriptionCount: number,
  client: ResolverStripeClient, nowSeconds: number, log: ResolutionLog): Promise<Set<string>> {
  const resolved = new Set<string>();
  const orphans = findings.flatMap((finding) => (finding.kind === 'orphaned_subscription' ? [finding] : []));
  if (orphans.length === 0) return resolved;
  if (ratioBreakerTripped(orphans.length, orphans.length + localSubscriptionCount)) {
    log.paused.push({ count: orphans.length, kind: 'orphan_subscription_canceled', reason: `${orphans.length} open Stripe subscriptions have no record in IDOC, against only ${localSubscriptionCount} in IDOC; that looks like a database that is not yet populated or the wrong Stripe account, so none were cancelled.` });
    return resolved;
  }
  const createdById = new Map(stripeSubscriptions.map((subscription) => [subscription.id, subscription.created ?? null]));
  for (const orphan of orphans) {
    const created = createdById.get(orphan.externalSubscriptionId);
    if (!OPEN.has(orphan.stripeStatus) || created === null || created === undefined || nowSeconds - created < ORPHAN_MIN_AGE_SECONDS) continue;
    try {
      if (!client.subscriptions.retrieve) continue;
      const live = await client.subscriptions.retrieve(orphan.externalSubscriptionId);
      if (!OPEN.has(live.status)) continue;
      // The last check before the irreversible call: a notification may have created the local row since the scan read the table.
      const [local] = await db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.externalSubscriptionId, orphan.externalSubscriptionId)).limit(1);
      if (local) continue;
      if (log.stripeMode === 'apply') {
        if (!client.subscriptions.cancel) continue;
        await client.subscriptions.cancel(orphan.externalSubscriptionId, {}, { idempotencyKey: `idoc-orphan-subscription-cancel-${orphan.externalSubscriptionId}` });
        await db.insert(auditLog).values({ action: 'reconciliation.orphan_subscription_canceled', entityType: 'stripe_subscription', entityId: orphan.externalSubscriptionId,
          beforeJson: { customer: orphan.externalCustomerId, status: live.status }, reason: 'No matching IDOC subscription; IDOC records are authoritative.' });
      }
      resolved.add(orphan.externalSubscriptionId);
      note(log, { id: orphan.externalSubscriptionId, kind: 'orphan_subscription_canceled', outcome: log.stripeMode === 'apply' ? 'applied' : 'simulated',
        summary: `Open Stripe subscription (${live.status}) with no record in IDOC ${log.stripeMode === 'apply' ? 'cancelled' : 'would be cancelled in production'}.` });
    } catch {
      note(log, { id: orphan.externalSubscriptionId, kind: 'orphan_subscription_canceled', outcome: 'failed', summary: 'The cancellation failed and will be retried by the next scan.' });
    }
  }
  return resolved;
}

/** An unlinked Stripe customer is deleted only when it is a day old, still unlinked in IDOC, has no subscription that is not cancelled, no open invoice and no
 * charge in the last 90 days, and the class is skipped when unlinked customers are a large share of everything compared. */
export async function resolveUnlinkedCustomers(findings: ReconciliationFinding[], customers: Array<{ created?: number; id: string }>, localAccountCount: number,
  protectedCustomerIds: Set<string>, client: ResolverStripeClient, nowSeconds: number, log: ResolutionLog): Promise<Set<string>> {
  const resolved = new Set<string>();
  const unlinked = findings.flatMap((finding) => (finding.kind === 'unlinked_customer' ? [finding.externalCustomerId] : []));
  if (unlinked.length === 0) return resolved;
  if (ratioBreakerTripped(unlinked.length, unlinked.length + localAccountCount)) {
    log.paused.push({ count: unlinked.length, kind: 'unlinked_customer_deleted', reason: `${unlinked.length} Stripe customers have no record in IDOC, against only ${localAccountCount} billing accounts in IDOC; that looks like a database that is not yet populated or the wrong Stripe account, so none were deleted.` });
    return resolved;
  }
  if (!client.subscriptions.list || !client.invoices || !client.charges) return resolved; // cannot verify safely: leave for a person
  const createdById = new Map(customers.map((customer) => [customer.id, customer.created ?? null]));
  const since = nowSeconds - CUSTOMER_RECENT_CHARGE_DAYS * 86_400;
  const check = async (id: string) => {
    const created = createdById.get(id);
    if (protectedCustomerIds.has(id) || created === null || created === undefined || nowSeconds - created < CUSTOMER_MIN_AGE_SECONDS) return;
    try {
      const [linked] = await db.select({ id: billingAccounts.id }).from(billingAccounts).where(eq(billingAccounts.externalCustomerId, id)).limit(1);
      if (linked) return;
      const live: Array<{ id: string; status: string }> = [];
      for (let cursor: string | undefined; ;) {
        const page = await client.subscriptions.list!({ customer: id, limit: 100, status: 'all', ...(cursor ? { starting_after: cursor } : {}) });
        live.push(...page.data);
        cursor = page.data.at(-1)?.id;
        if (!page.has_more || !cursor) break;
      }
      if (live.some((subscription) => subscription.status !== 'canceled' && subscription.status !== 'incomplete_expired')) return;
      const [invoices, charges] = await Promise.all([client.invoices!.list({ customer: id, limit: 1, status: 'open' }), client.charges!.list({ created: { gte: since }, customer: id, limit: 1 })]);
      if (invoices.data.length || charges.data.length) return;
      if (log.stripeMode === 'apply') {
        if (!client.customers?.del) return;
        await client.customers.del(id);
        await db.insert(auditLog).values({ action: 'reconciliation.unlinked_customer_deleted', entityType: 'stripe_customer', entityId: id,
          beforeJson: { created }, reason: 'No matching IDOC billing account; deleted by the reconciliation scan.' }).catch(() => undefined);
      }
      resolved.add(id);
      note(log, { id, kind: 'unlinked_customer_deleted', outcome: log.stripeMode === 'apply' ? 'applied' : 'simulated',
        summary: `Stripe customer with no record in IDOC, no live subscription, open invoice or recent charge ${log.stripeMode === 'apply' ? 'deleted' : 'would be deleted in production'}.` });
    } catch {
      note(log, { id, kind: 'unlinked_customer_deleted', outcome: 'failed', summary: 'The check or deletion failed and will be retried by the next scan.' });
    }
  }
  for (let index = 0; index < unlinked.length; index += 5) await Promise.all(unlinked.slice(index, index + 5).map(check));
  return resolved;
}

const SUMMARY_ACTION_CAP = 300;

/** The JSON stored with each scan so the report can say what was done (or, outside production, what would be done) without a rescan. */
export function summarizeResolution(log: ResolutionLog) {
  const counts: Record<string, number> = {};
  for (const action of log.actions) counts[`${action.kind}:${action.outcome}`] = (counts[`${action.kind}:${action.outcome}`] ?? 0) + 1;
  return { actions: log.actions.slice(0, SUMMARY_ACTION_CAP), counts, paused: log.paused, stripeMode: log.stripeMode, truncated: log.actions.length > SUMMARY_ACTION_CAP };
}
