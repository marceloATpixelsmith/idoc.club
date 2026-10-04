import 'server-only';

import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { auditLog, memberships, profiles, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireAccountAccess } from './data-access';
import { requireAdministrator } from './authorization';
import { lockLatestMembership } from './locking';
import { cancelOpenSubscriptionIfAny } from '@/lib/payments/subscription-cancellation';
import { unsubscribeFromMarketingAudience } from '@/lib/notifications/mailchimp-marketing';
import type { CancellationStripeClient } from '@/lib/payments/stripe';

const REINSTATABLE_STATUSES = ['active', 'grace', 'complimentary'] as const;
// Deliberately excludes 'suspended' (legacy): cancellation goes through suspendMembership below, which
// has a Stripe-cancellation safety net this generic correction tool doesn't. Letting 'suspended'
// through here would split the audit taxonomy across two action names for the same transition.
const CORRECTABLE_STATUSES = ['active', 'grace', 'expired', 'canceled', 'complimentary', 'review_required'] as const;

const reasonSchema = z.string().trim().min(1, 'A reason is required').max(1000);

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Administrator cancellation of a membership (docs/08 item 14; the action keeps its original name).
 * Like a member's own cancellation it works through the end of the current paid cycle: the
 * membership becomes 'canceled' with valid_until untouched, the member keeps access until that
 * date, any open Stripe subscription is set to end at period end rather than renew, and the audit
 * trail records the required reason. After the paid-through date the relationship is over and the
 * member can no longer sign in (lib/membership/session-gate.ts). To cut a compromised or abusive
 * account off immediately, use suspendUserAccount (account-suspension.ts) instead. The DB change
 * commits first and always succeeds independent of Stripe's availability -- access control must not
 * depend on a network call. If already canceled with an open subscription still on file (e.g. a
 * prior Stripe call failed), re-running this retries the Stripe call without a duplicate audit entry.
 */
export async function suspendMembership(profileId: number, untrustedReason: unknown, testStripeClient?: CancellationStripeClient) {
  const reason = reasonSchema.parse(untrustedReason);
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);

  const { membership, wasAlreadySuspended } = await db.transaction(async (tx) => {
    const current = await lockLatestMembership(tx, profileId);
    if (!current) throw new Error('Member has no membership on file to cancel.');
    if (current.status === 'canceled' || current.status === 'suspended') return { membership: current, wasAlreadySuspended: true };
    const [updated] = await tx.update(memberships).set({ status: 'canceled', updatedAt: new Date() })
      .where(eq(memberships.id, current.id)).returning();
    await tx.insert(auditLog).values({
      action: 'admin.membership.canceled', actorId: actor.id,
      afterJson: { membership: updated }, beforeJson: { membership: current },
      entityId: String(profileId), entityType: 'profile', reason,
    });
    return { membership: updated, wasAlreadySuspended: false };
  });

  const stripeResult = await cancelOpenSubscriptionIfAny(profileId, testStripeClient);
  // Like a member's own cancellation, an administrator's removes the member from the marketing
  // mailing list. Best-effort: it can never block or undo the membership-level cancellation.
  if (!wasAlreadySuspended) {
    const [account] = await db.select({ email: users.email }).from(profiles).innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.id, profileId)).limit(1);
    if (account?.email) {
      try { await unsubscribeFromMarketingAudience(account.email); } catch { /* best-effort only */ }
    }
  }
  if (wasAlreadySuspended && !stripeResult.stripeCancelled && !stripeResult.stripeCancelError) {
    throw new Error('This membership is already canceled.');
  }
  return { membership, ...stripeResult };
}

const reinstateSchema = z.object({
  reason: reasonSchema,
  status: z.enum(REINSTATABLE_STATUSES),
});

/** Reverses a cancellation (or a legacy suspension). valid_until is untouched, so the member keeps whatever term was paid for. */
export async function reinstateMembership(profileId: number, untrustedInput: unknown) {
  const input = reinstateSchema.parse(untrustedInput);
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);

  return db.transaction(async (tx) => {
    const current = await lockLatestMembership(tx, profileId);
    if (!current) throw new Error('Member has no membership on file to reinstate.');
    if (current.status !== 'canceled' && current.status !== 'suspended') throw new Error('This membership is not currently canceled.');
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

const extendExpirationSchema = z.object({
  reason: reasonSchema,
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD')
    .refine(isRealCalendarDate, 'Enter a real calendar date'),
});

/** Extends an entitlement without touching payment or Stripe records. An equal date is a safe,
 * idempotent retry; a shorter date must use the broader correction workflow. */
export async function extendMembershipExpiration(profileId: number, untrustedInput: unknown) {
  const input = extendExpirationSchema.parse(untrustedInput);
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return db.transaction(async (tx) => {
    const current = await lockLatestMembership(tx, profileId);
    if (!current) throw new Error('Member has no membership on file to extend.');
    if (input.validUntil < current.validUntil) throw new Error('An expiration extension cannot shorten the current paid-through date.');
    if (input.validUntil === current.validUntil) return { membership: current, unchanged: true };
    const [updated] = await tx.update(memberships).set({ updatedAt: new Date(), validUntil: input.validUntil })
      .where(eq(memberships.id, current.id)).returning();
    await tx.insert(auditLog).values({
      action: 'admin.membership.expiration_extended', actorId: actor.id,
      afterJson: { validUntil: updated.validUntil }, beforeJson: { validUntil: current.validUntil },
      entityId: String(profileId), entityType: 'profile', reason: input.reason,
    });
    return { membership: updated, unchanged: false };
  });
}
