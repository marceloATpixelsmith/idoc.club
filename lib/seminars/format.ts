/** Shared, dependency-free formatting for seminar schedules and prices -- used by every seminar
 * listing/detail surface (member, guest, admin) so the same seminar always reads identically
 * wherever it appears. */

/** Parses a bare "YYYY-MM-DD" calendar date into a local-midnight Date -- `new Date('YYYY-MM-DD')`
 * parses as UTC midnight, which shifts a day back once formatted in any timezone west of UTC. These
 * dates carry no time or zone, so a plain local construction is the only reading that never drifts. */
function localDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** "September 29, 2026" -- the same full-month/day/year shape the homepage's Upcoming Seminars
 * widget and the news pages already use, so a date reads identically everywhere on the site. */
export function formatDate(value: string): string {
  return localDateOnly(value).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** A seminar schedule is composed only of calendar dates. */
export function formatSchedule(seminar: { end_date: string; start_date: string }): string {
  return seminar.start_date === seminar.end_date
    ? formatDate(seminar.start_date)
    : `${formatDate(seminar.start_date)} – ${formatDate(seminar.end_date)}`;
}

export function formatAdminDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
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
