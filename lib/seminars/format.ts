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

function formatTime(value: string): string {
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hours, minutes));
}

/** A same-day schedule displays both real times; multi-day schedules retain both endpoint times. */
export function formatSchedule(seminar: { end_date: string; end_time: string; start_date: string; start_time: string }): string {
  return seminar.start_date === seminar.end_date
    ? `${formatDate(seminar.start_date)}, ${formatTime(seminar.start_time)}–${formatTime(seminar.end_time)}`
    : `${formatDate(seminar.start_date)}, ${formatTime(seminar.start_time)} – ${formatDate(seminar.end_date)}, ${formatTime(seminar.end_time)}`;
}

export function money(cents: number): string {
  return cents > 0 ? new Intl.NumberFormat('en-IE', { currency: 'EUR', style: 'currency' }).format(cents / 100) : 'No fee';
}

const LEVEL_LABELS: Record<string, string> = { level_1: 'Level 1', level_2: 'Level 2', level_3: 'Level 3' };

/** "all_levels" always stands alone (lib/seminars/seminars.ts's parseLevels enforces this at the
 * data layer) and displays as the literal "All levels" rather than being combined with individual
 * levels. */
export function formatLevels(levels: string[]): string {
  if (levels.includes('all_levels')) return 'All levels';
  return levels.map((level) => LEVEL_LABELS[level] ?? level).join(', ');
}
