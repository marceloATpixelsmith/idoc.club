import { zonedDateTimeToUtc } from './timezone.ts';

export const SEMINAR_STATUSES = ['draft', 'published', 'canceled'] as const;
export type SeminarStatus = (typeof SEMINAR_STATUSES)[number];

export const REGISTRATION_STATUSES = ['registered', 'canceled'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'bank_transfer_pending', 'cash_pending', 'paid'] as const;
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
  bank_transfer_pending: 'Bank transfer pending', cash_pending: 'Cash pending', paid: 'Paid', unpaid: 'Unpaid',
};

/** Combines the seminar's own date/end-time/timezone into the UTC instant the seminar ends. */
export function seminarEndsAtUtc(input: { endTime: string; seminarDate: string; timezone: string }): Date {
  return zonedDateTimeToUtc(input.seminarDate, input.endTime, input.timezone);
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
