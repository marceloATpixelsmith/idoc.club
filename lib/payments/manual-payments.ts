import 'server-only';

import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, memberships, payments, profiles } from '@/lib/db/schema';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { MANUAL_PAYMENT_SOURCES, MEMBERSHIP_CURRENCY, MEMBERSHIP_FEE_CENTS, type ManualPaymentSource } from './pricing';
import { nextValidUntil } from './renewal';

// PayPal/bank transfer need a transaction reference as evidence (docs/02 §4); cash and
// complimentary grants may not have one.
const REFERENCE_REQUIRED_SOURCES: readonly ManualPaymentSource[] = ['paypal', 'bank_transfer'];

const manualPaymentSchema = z.object({
  profileId: z.coerce.number().int().positive(),
  source: z.enum(MANUAL_PAYMENT_SOURCES),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the paid date as YYYY-MM-DD'),
  reference: z.string().trim().max(500).optional().transform((value) => value || null),
  reason: z.string().trim().min(1, 'A reason is required').max(1000),
}).superRefine(({ source, reference }, ctx) => {
  if (REFERENCE_REQUIRED_SOURCES.includes(source) && !reference) {
    ctx.addIssue({ code: 'custom', message: 'A transaction/reference is required for this payment source', path: ['reference'] });
  }
});

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function latestMembership(tx: Transaction, profileId: number) {
  const [membership] = await tx.select().from(memberships).where(eq(memberships.profileId, profileId))
    .orderBy(desc(memberships.validUntil)).limit(1);
  return membership ?? null;
}

/**
 * Records an EUR manual payment (paypal/bank_transfer/cash) or a complimentary grant, and extends
 * membership using the same rolling-calendar rule Stripe payments use (docs/02 §5, §8). Payment,
 * entitlement change, and audit entry commit in one transaction. The fee is always the fixed
 * MEMBERSHIP_FEE_CENTS — there is no amount input on this function's signature, by design, so no
 * caller can ever submit a partial/discounted/waived amount (docs/02 §5). A complimentary grant
 * still records the nominal MEMBERSHIP_FEE_CENTS value (payments.amountCents requires > 0 for
 * every source); `source` is the only reliable discriminator between real and waived revenue.
 */
export async function recordManualPayment(untrustedInput: unknown) {
  const input = manualPaymentSchema.parse(untrustedInput);
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, input.profileId)).limit(1);
  if (!profile) throw new Error('Member profile not found.');

  return db.transaction(async (tx) => {
    const [payment] = await tx.insert(payments).values({
      administratorId: actor.id,
      amountCents: MEMBERSHIP_FEE_CENTS,
      currency: MEMBERSHIP_CURRENCY.toUpperCase(),
      paidAt: new Date(`${input.paidAt}T00:00:00.000Z`),
      profileId: input.profileId,
      reason: input.reason,
      reference: input.reference,
      source: input.source,
    }).returning();

    const membership = await latestMembership(tx, input.profileId);
    const validUntil = nextValidUntil({ currentValidUntil: membership?.validUntil ?? null, paidAt: input.paidAt });
    // A suspended membership stays suspended — reinstatement is a separate, not-yet-built admin
    // action (docs/08 item 14); a payment alone must not silently lift a suspension.
    const status = membership?.status === 'suspended' ? 'suspended' : (input.source === 'complimentary' ? 'complimentary' : 'active');
    const [membershipRow] = membership
      ? await tx.update(memberships).set({ status, updatedAt: new Date(), validUntil })
        .where(eq(memberships.id, membership.id)).returning()
      : await tx.insert(memberships).values({
        membershipType: 'standard', profileId: input.profileId, source: 'manual',
        startsOn: input.paidAt, status, validUntil,
      }).returning();

    await tx.insert(auditLog).values({
      action: 'admin.payment.recorded', actorId: actor.id,
      afterJson: { membership: membershipRow, payment },
      beforeJson: membership ? { membership } : null,
      entityId: String(input.profileId), entityType: 'payment', reason: input.reason,
    });

    return { membership: membershipRow, payment };
  });
}
