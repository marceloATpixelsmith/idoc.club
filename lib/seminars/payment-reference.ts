/** How an administrator can record a seminar payment as received, and the evidence label for each. The labels match the
 * member manual-payment form (docs/02 section 4): Stripe Payment ID, Bank Transfer Reference, Receipt ID. */
export const SEMINAR_PAYMENT_RECEIVED_VIA = [
  { label: 'Cash', value: 'cash_event' },
  { label: 'Bank Transfer', value: 'bank_transfer' },
  { label: 'Stripe', value: 'online_stripe' },
] as const;

export const SEMINAR_PAYMENT_REFERENCE_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer Reference',
  cash_event: 'Receipt ID',
  online_stripe: 'Stripe Payment ID',
};

export function seminarPaymentReferenceLabel(method: string): string {
  return SEMINAR_PAYMENT_REFERENCE_LABELS[method] ?? 'Payment reference';
}
