import 'server-only';

import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, memberships, subscriptions } from '@/lib/db/schema';
import { requireAccountAccess } from './data-access';
import { requireAdministrator } from './authorization';
import { lockLatestMembership } from './locking';
import { OPEN_SUBSCRIPTION_STATUSES } from '@/lib/payments/pricing';
import { cancelMemberSubscription, type CancellationStripeClient } from '@/lib/payments/stripe';

const REINSTATABLE_STATUSES = ['active', 'grace', 'complimentary', 'canceled'] as const;
// Deliberately excludes 'suspended': all suspension goes through suspendMembership below, which
// has a Stripe-cancellation safety net this generic correction tool doesn't. Letting 'suspended'
// through here would split the audit taxonomy across two action names for the same transition.
const CORRECTABLE_STATUSES = ['active', 'grace', 'expired', 'canceled', 'complimentary', 'review_required'] as const;

const reasonSchema = z.string().trim().min(1, 'A reason is required').max(1000);

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function findOpenSubscription(profileId: number) {
  const [subscription] = await db.select({ externalSubscriptionId: subscriptions.externalSubscriptionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.profileId, profileId), inArray(subscriptions.status, OPEN_SUBSCRIPTION_STATUSES)))
    .orderBy(desc(subscriptions.createdAt)).limit(1);
  return subscription ?? null;
}

// Best-effort: cancels an open Stripe subscription if one exists, never throws. Does not write
// subscriptions.status — the customer.subscription.deleted webhook this triggers owns that write.
async function cancelOpenSubscriptionIfAny(profileId: number, testStripeClient?: CancellationStripeClient): Promise<{ stripeCancelError?: string; stripeCancelled: boolean }> {
  const subscription = await findOpenSubscription(profileId);
  if (!subscription) return { stripeCancelled: false };
  try {
    await cancelMemberSubscription(subscription.externalSubscriptionId, testStripeClient);
    return { stripeCancelled: true };
  } catch (error) {
    return { stripeCancelError: error instanceof Error ? error.message : 'Unknown Stripe error.', stripeCancelled: false };
  }
}

/**
 * Suspends a membership (docs/08 item 14): denies access regardless of paid-through date, freezes
 * valid_until (a reinstated member keeps whatever remaining term they had), and best-effort
 * cancels an open Stripe subscription immediately so a suspended member is never billed. The DB
 * suspension commits first and always succeeds independent of Stripe's availability — access
 * control must not depend on a network call. If already suspended with an open subscription still
 * on file (e.g. a prior Stripe cancel failed or never fired), re-running this retries the Stripe
 * cancellation without writing a duplicate audit entry.
 */
export async function suspendMembership(profileId: number, untrustedReason: unknown, testStripeClient?: CancellationStripeClient) {
  const reason = reasonSchema.parse(untrustedReason);
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);

  const { membership, wasAlreadySuspended } = await db.transaction(async (tx) => {
    const current = await lockLatestMembership(tx, profileId);
    if (!current) throw new Error('Member has no membership on file to suspend.');
    if (current.status === 'suspended') return { membership: current, wasAlreadySuspended: true };
    const [updated] = await tx.update(memberships).set({ status: 'suspended', updatedAt: new Date() })
      .where(eq(memberships.id, current.id)).returning();
    await tx.insert(auditLog).values({
      action: 'admin.membership.suspended', actorId: actor.id,
      afterJson: { membership: updated }, beforeJson: { membership: current },
      entityId: String(profileId), entityType: 'profile', reason,
    });
    return { membership: updated, wasAlreadySuspended: false };
  });

  const stripeResult = await cancelOpenSubscriptionIfAny(profileId, testStripeClient);
  if (wasAlreadySuspended && !stripeResult.stripeCancelled && !stripeResult.stripeCancelError) {
    throw new Error('This membership is already suspended.');
  }
  return { membership, ...stripeResult };
}

const reinstateSchema = z.object({
  reason: reasonSchema,
  status: z.enum(REINSTATABLE_STATUSES),
});

/** Restores access for a suspended membership. valid_until is untouched — restores whatever remaining term was frozen at suspension time. */
export async function reinstateMembership(profileId: number, untrustedInput: unknown) {
  const input = reinstateSchema.parse(untrustedInput);
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);

  return db.transaction(async (tx) => {
    const current = await lockLatestMembership(tx, profileId);
    if (!current) throw new Error('Member has no membership on file to reinstate.');
    if (current.status !== 'suspended') throw new Error('This membership is not currently suspended.');
    const [updated] = await tx.update(memberships).set({ status: input.status, updatedAt: new Date() })
      .where(eq(memberships.id, current.id)).returning();
    await tx.insert(auditLog).values({
      action: 'admin.membership.reinstated', actorId: actor.id,
      afterJson: { membership: updated }, beforeJson: { membership: current },
      entityId: String(profileId), entityType: 'profile', reason: input.reason,
    });
    return { membership: updated };
  });
}

const correctEntitlementSchema = z.object({
  reason: reasonSchema,
  status: z.enum(CORRECTABLE_STATUSES).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD').refine(isRealCalendarDate, 'Enter a real calendar date').optional(),
}).refine(({ status, validUntil }) => status !== undefined || validUntil !== undefined, {
  message: 'Provide a new paid-through date, a new status, or both.',
  path: ['validUntil'],
});

/** Directly corrects an existing membership's paid-through date and/or status (docs/02 §5: "an audited override"). Does not grant a new membership — recordManualPayment does that. */
export async function correctEntitlement(profileId: number, untrustedInput: unknown) {
  const input = correctEntitlementSchema.parse(untrustedInput);
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);

  return db.transaction(async (tx) => {
    const current = await lockLatestMembership(tx, profileId);
    if (!current) throw new Error('Member has no membership on file to correct.');
    const nextValidUntil = input.validUntil ?? current.validUntil;
    if (nextValidUntil < current.startsOn) throw new Error('The paid-through date cannot be before the start date.');
    const [updated] = await tx.update(memberships).set({
      status: input.status ?? current.status,
      updatedAt: new Date(),
      validUntil: nextValidUntil,
    }).where(eq(memberships.id, current.id)).returning();
    await tx.insert(auditLog).values({
      action: 'admin.membership.corrected', actorId: actor.id,
      afterJson: { membership: updated }, beforeJson: { membership: current },
      entityId: String(profileId), entityType: 'profile', reason: input.reason,
    });
    return { membership: updated };
  });
}
