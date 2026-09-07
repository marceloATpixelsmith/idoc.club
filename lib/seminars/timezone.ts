// Dependency-free, pure timezone helpers (no 'server-only' import so this stays testable without a
// DB and reusable from client components that only need display formatting).

const VALID_TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

export function isValidIanaTimeZone(value: string): boolean {
  return VALID_TIME_ZONES.has(value);
}

/** Converts a wall-clock date + time declared in `timeZone` to the UTC instant it represents,
 * using only built-in `Intl` (no date library dependency). This is the standard "guess and
 * correct" technique: interpret the wall-clock values as if they were already UTC, ask `Intl` what
 * that instant reads as in the target zone, then correct by the difference -- one pass is exact for
 * every real IANA zone, since UTC offsets change only in discrete steps, never continuously. */
export function zonedDateTimeToUtc(dateIso: string, timeIso: string, timeZone: string): Date {
  const guess = new Date(`${dateIso}T${timeIso}Z`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit', hour: '2-digit', hour12: false, minute: '2-digit',
    month: '2-digit', second: '2-digit', timeZone, year: 'numeric',
  });
  const parts = Object.fromEntries(formatter.formatToParts(guess).map((part) => [part.type, part.value]));
  const readAsIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return new Date(guess.getTime() - (readAsIfUtc - guess.getTime()));
}
