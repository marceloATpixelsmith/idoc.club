/** Shared, dependency-free formatting for seminar schedules and prices -- used by every seminar
 * listing/detail surface (member, guest, admin) so the same seminar always reads identically
 * wherever it appears. */

/** Parses a bare "YYYY-MM-DD" calendar date into a local-midnight Date -- `new Date('YYYY-MM-DD')`
 * parses as UTC midnight, which shifts a day back once formatted in any timezone west of UTC. These
 * dates carry no timezone of their own (the seminar's own `timezone` field is separate and only
 * matters for computing availability), so a plain local construction is the only reading that never
 * drifts. */
function localDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** "September 29, 2026" -- the same full-month/day/year shape the homepage's Upcoming Seminars
 * widget and the news pages already use, so a date reads identically everywhere on the site. */
export function formatDate(value: string): string {
  return localDateOnly(value).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "9:00 AM" from a stored "HH:MM" or "HH:MM:SS" 24-hour string. */
export function formatTime(value: string): string {
  const [hours, minutes] = value.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}

/** Same-day seminars show one date/time; a seminar spanning multiple days shows both ends of the
 * range instead, per docs/08's multi-day requirement. Human-readable throughout (no raw ISO), since
 * this is the string members and guests actually read. */
export function formatSchedule(seminar: { end_date: string; end_time: string; start_date: string; start_time: string }): string {
  const startTime = formatTime(seminar.start_time);
  const endTime = formatTime(seminar.end_time);
  return seminar.start_date === seminar.end_date
    ? `${formatDate(seminar.start_date)} · ${startTime}–${endTime}`
    : `${formatDate(seminar.start_date)}, ${startTime} – ${formatDate(seminar.end_date)}, ${endTime}`;
}

export function money(cents: number): string {
  return cents > 0 ? new Intl.NumberFormat('en-IE', { currency: 'EUR', style: 'currency' }).format(cents / 100) : 'No fee';
}
