const GRACE_PERIOD_DAYS = 5;

/** docs/02 §5.1: notice windows and the mid-grace reminder point. */
export const AUTO_RENEWAL_NOTICE_DAYS = 15;
export const NON_RENEWAL_EXPIRATION_NOTICE_DAYS = 30;
export const GRACE_REMINDER_DAYS_BEFORE_END = 2;

function addToIsoDate(isoDate: string, { years = 0, days = 0 }: { days?: number; years?: number }): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year + years, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Rolling 12-month membership calendar (docs/02 §5). A payment made on or before the current
 * paid-through date is an early renewal and adds 12 months to that date, so the member never loses
 * unused time. A payment made after the current paid-through date (or a brand-new membership, where
 * `currentValidUntil` is null) starts a fresh 12-month term on the actual payment date.
 */
export function nextValidUntil({ currentValidUntil, paidAt }: { currentValidUntil: string | null; paidAt: string }): string {
  const base = currentValidUntil && currentValidUntil >= paidAt ? currentValidUntil : paidAt;
  return addToIsoDate(base, { years: 1 });
}

/** Five calendar days of continued access from a failed automatic-renewal date (docs/02 §5.1). */
export function gracePeriodEnd(failedRenewalDate: string): string {
  return addToIsoDate(failedRenewalDate, { days: GRACE_PERIOD_DAYS });
}
