/** Evidence an administrator records when marking an offline seminar payment received (docs/02 section 12). */
export const SEMINAR_PAYMENT_REFERENCE_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer Reference',
  cash_event: 'Receipt ID',
};

export function seminarPaymentReferenceLabel(method: string): string {
  return SEMINAR_PAYMENT_REFERENCE_LABELS[method] ?? 'Payment reference';
}
