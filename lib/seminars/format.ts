/** Shared, dependency-free formatting for seminar schedules and prices -- used by every seminar
 * listing/detail surface (member, guest, admin) so the same seminar always reads identically
 * wherever it appears. */

/** Same-day seminars show one date/time; a seminar spanning multiple days shows both ends of the
 * range instead, per docs/08's multi-day requirement. */
export function formatSchedule(seminar: { end_date: string; end_time: string; start_date: string; start_time: string }): string {
  const startTime = seminar.start_time.slice(0, 5);
  const endTime = seminar.end_time.slice(0, 5);
  return seminar.start_date === seminar.end_date
    ? `${seminar.start_date} · ${startTime}–${endTime}`
    : `${seminar.start_date} ${startTime} – ${seminar.end_date} ${endTime}`;
}

export function money(cents: number): string {
  return cents > 0 ? new Intl.NumberFormat('en-IE', { currency: 'EUR', style: 'currency' }).format(cents / 100) : 'No fee';
}
