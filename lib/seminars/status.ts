

export const SEMINAR_STATUSES = ['draft', 'published', 'canceled'] as const;
export type SeminarStatus = (typeof SEMINAR_STATUSES)[number];

export const REGISTRATION_STATUSES = ['registered', 'canceled'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** The registration's approval ("Registration Status" in the UI) -- independent of both the lifecycle
 * `registrationStatus` above and the payment status. A non-FEI registration is 'confirmed' the moment
 * it is made; an FEI registration starts at 'pending_fei_approval' until an administrator records
 * the FEI decision. */
export const APPROVAL_STATUSES = ['confirmed', 'pending_fei_approval', 'approved_by_fei', 'not_approved_by_fei', 'approved_audit_only_by_fei'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const FEI_APPROVAL_STATUSES = APPROVAL_STATUSES.filter((status) => status !== 'confirmed');

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  approved_audit_only_by_fei: 'Approved to Audit Only by FEI', approved_by_fei: 'Approved by FEI', confirmed: 'Confirmed',
  not_approved_by_fei: 'Not Approved by FEI', pending_fei_approval: 'Pending FEI Approval',
};

export function initialApprovalStatus(isFei: boolean): ApprovalStatus {
  return isFei ? 'pending_fei_approval' : 'confirmed';
}

export const PAYMENT_STATUSES = ['unpaid', 'pending', 'bank_transfer_pending', 'cash_pending', 'paid', 'refunded', 'partially_refunded', 'refund_failed', 'disputed', 'chargeback'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** The member/public-facing availability of a seminar, derived at read time -- never stored. Distinct
 * from `SeminarStatus` (the administrator-set publication state): a 'published' seminar is further
 * classified as 'open', 'full', 'closed', or 'past' depending on capacity, the registration
 * deadline, and whether it has already ended, none of which the administrator sets directly. */
export const SEMINAR_AVAILABILITIES = ['draft', 'canceled', 'past', 'closed', 'full', 'open'] as const;
export type SeminarAvailability = (typeof SEMINAR_AVAILABILITIES)[number];

export const AVAILABILITY_LABELS: Record<SeminarAvailability, string> = {
  canceled: 'Canceled', closed: 'Registration closed', draft: 'Draft', full: 'Full', open: 'Open', past: 'Past',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  bank_transfer_pending: 'Bank transfer pending', cash_pending: 'Cash pending', chargeback: 'Chargeback', disputed: 'Disputed', paid: 'Paid', partially_refunded: 'Partially refunded', pending: 'Payment pending', refund_failed: 'Refund failed', refunded: 'Refunded', unpaid: 'Unpaid',
};

/** Returns the exclusive UTC boundary after a date-only seminar's final calendar day. */
export function seminarEndsAtUtc(input: { endDate: string }): Date {
  const end = new Date(`${input.endDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

export function computeSeminarAvailability(
  input: {
    activeRegistrationCount: number; capacity: number; endsAtUtc: Date;
    registrationDeadline: Date | string; status: SeminarStatus;
  },
  now: Date = new Date(),
): SeminarAvailability {
  if (input.status === 'draft') return 'draft';
  if (input.status === 'canceled') return 'canceled';
  if (now >= input.endsAtUtc) return 'past';
  if (now > new Date(input.registrationDeadline)) return 'closed';
  if (input.activeRegistrationCount >= input.capacity) return 'full';
  return 'open';
}

/** Registration status and payment status are independent stored facts (never merged into one
 * column); this only picks which one takes display priority -- a canceled registration always
 * shows as Canceled regardless of what its last known payment status was. */
export function registrationDisplayLabel(registrationStatus: RegistrationStatus, paymentStatus: PaymentStatus): string {
  return registrationStatus === 'canceled' ? 'Canceled' : PAYMENT_STATUS_LABELS[paymentStatus];
}

export function initialPaymentStatusForMethod(paymentMethod: string): PaymentStatus {
  if (paymentMethod === 'bank_transfer') return 'bank_transfer_pending';
  if (paymentMethod === 'cash_event') return 'cash_pending';
  return 'unpaid';
}
