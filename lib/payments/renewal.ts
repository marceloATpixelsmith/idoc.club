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

/** Five calendar days inclusive of the failed automatic-renewal date (D through D+4). */
export function gracePeriodEnd(failedRenewalDate: string): string {
  return addToIsoDate(failedRenewalDate, { days: GRACE_PERIOD_DAYS - 1 });
}

type InvoiceLinePeriods = { lines?: { data?: ({ period?: { start?: number | null } | null })[] | null } | null };

/**
 * The calendar date (UTC) on which a failed automatic renewal was due, used as day one of grace.
 * Stripe's top-level `invoice.period_start` is NOT usable here: on a subscription renewal invoice it
 * is the start of the PREVIOUS billing period (about a year earlier), which put the grace end in the
 * past and expired the membership at the next nightly scan. The invoice lines' `period.start` is the
 * start of the period being billed, i.e. the renewal date. Falls back to `now` when absent.
 */
export function failedRenewalDate(invoice: InvoiceLinePeriods, now: Date): string {
  const starts = (invoice.lines?.data ?? []).flatMap((line) => (typeof line.period?.start === 'number' ? [line.period.start] : []));
  return new Date(starts.length ? Math.max(...starts) * 1000 : now.getTime()).toISOString().slice(0, 10);
}
