import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, organizationSettings, seminarPaymentMethods } from '@/lib/db/schema';
import { requireSuperAdmin, type Actor } from '@/lib/membership/authorization';
import { formatOrganizationAddress, hasVisibleBankInstructions, sanitizeBankInstructions, type OrganizationAddress } from '@/lib/organization/format';
import 'server-only';

export { formatOrganizationAddress, sanitizeBankInstructions } from '@/lib/organization/format';
export type { OrganizationAddress } from '@/lib/organization/format';

export const PAYMENT_METHOD_IDS = ['online_stripe', 'bank_transfer', 'cash_event'] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

function clean(value: unknown, maximum: number) {
  const result = typeof value === 'string' ? value.trim() : '';
  return result ? result.slice(0, maximum) : null;
}


/** Selects only public address columns, never the administrative payment configuration. */
export async function getPublicOrganizationAddress(): Promise<OrganizationAddress | null> {
  const [address] = await db.select({ address1: organizationSettings.address1, address2: organizationSettings.address2,
    city: organizationSettings.city, country: organizationSettings.country, postalCode: organizationSettings.postalCode,
    stateProvince: organizationSettings.stateProvince }).from(organizationSettings).where(eq(organizationSettings.id, 1));
  return address ?? null;
}

export async function getOrganizationSettings(actor: Actor) {
  requireSuperAdmin(actor);
  return { address: await getPublicOrganizationAddress(), paymentMethods: await db.select().from(seminarPaymentMethods).orderBy(asc(seminarPaymentMethods.displayOrder), asc(seminarPaymentMethods.canonicalId)) };
}

export async function updateOrganizationSettings(actor: Actor, input: { address: Record<string, unknown>; bankEnabled: boolean; bankInstructions: string; cashEnabled: boolean }) {
  requireSuperAdmin(actor);
  const address = { address1: clean(input.address.address1, 200), address2: clean(input.address.address2, 200), city: clean(input.address.city, 100),
    country: clean(input.address.country, 100), postalCode: clean(input.address.postalCode, 30), stateProvince: clean(input.address.stateProvince, 100) };
  const sanitizedInstructions = sanitizeBankInstructions(input.bankInstructions.trim());
  if (input.bankEnabled && !hasVisibleBankInstructions(sanitizedInstructions)) throw new Error('Bank Transfer instructions are required when the method is enabled.');

  await db.transaction(async (tx) => {
    const [beforeAddress] = await tx.select().from(organizationSettings).where(eq(organizationSettings.id, 1)).for('update');
    const beforeMethods = await tx.select().from(seminarPaymentMethods).orderBy(asc(seminarPaymentMethods.displayOrder)).for('update');
    if (beforeMethods.map((method) => method.canonicalId).join(',') !== PAYMENT_METHOD_IDS.join(',')) throw new Error('Canonical payment-method configuration is invalid.');
    await tx.insert(organizationSettings).values({ id: 1, ...address }).onConflictDoUpdate({ target: organizationSettings.id, set: { ...address, updatedAt: new Date() } });
    const previousBank = beforeMethods.find((method) => method.canonicalId === 'bank_transfer')!;
    const effectiveBankInstructions = !input.bankEnabled && !sanitizedInstructions ? previousBank.instructionsHtml : sanitizedInstructions || null;
    await tx.update(seminarPaymentMethods).set({ enabled: input.bankEnabled, instructionsHtml: effectiveBankInstructions, updatedAt: new Date() }).where(eq(seminarPaymentMethods.canonicalId, 'bank_transfer'));
    await tx.update(seminarPaymentMethods).set({ enabled: input.cashEnabled, updatedAt: new Date() }).where(eq(seminarPaymentMethods.canonicalId, 'cash_event'));
    const changedAddressFields = Object.keys(address).filter((key) => (beforeAddress?.[key as keyof typeof beforeAddress] ?? null) !== address[key as keyof typeof address]);
    if (changedAddressFields.length) await tx.insert(auditLog).values({ action: 'admin.organization_address.updated', actorId: actor.id, entityId: '1', entityType: 'organization_settings', afterJson: { changedFields: changedAddressFields } });
    for (const method of beforeMethods.filter((item) => item.canonicalId !== 'online_stripe')) {
      const enabled = method.canonicalId === 'bank_transfer' ? input.bankEnabled : input.cashEnabled;
      const instructionsChanged = method.canonicalId === 'bank_transfer' && method.instructionsHtml !== effectiveBankInstructions;
      if (method.enabled !== enabled || instructionsChanged) await tx.insert(auditLog).values({ action: 'admin.seminar_payment_method.updated', actorId: actor.id,
        entityId: method.canonicalId, entityType: 'seminar_payment_method', beforeJson: { enabled: method.enabled, instructionsPresent: Boolean(method.instructionsHtml) },
        afterJson: { enabled, instructionsChanged, instructionsPresent: method.canonicalId === 'bank_transfer' ? Boolean(effectiveBankInstructions) : false } });
    }
    // Reassert the immutable system invariant even if a hostile client submitted extra fields.
    await tx.execute(sql`update idoc.seminar_payment_methods set enabled=true, system_protected=true, display_label='Online via Stripe', display_order=10, instructions_html=null where canonical_id='online_stripe'`);
  });
}
