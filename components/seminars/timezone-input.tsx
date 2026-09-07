'use client';

import { useMemo } from 'react';

/** A plain text input with a browser-native autocomplete list of every IANA timezone the current
 * runtime knows about (computed client-side via Intl.supportedValuesOf, so no ~400-entry list has
 * to be serialized from the server). Server-side validation (lib/seminars/seminars.ts) is the real
 * authority -- this is convenience only. */
export function TimezoneInput({ defaultValue }: { defaultValue?: string }) {
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [];
    }
  }, []);
  return (
    <>
      <input className="mt-1 block w-full border p-2" defaultValue={defaultValue} list="seminar-timezones" name="timezone" placeholder="e.g. Europe/Berlin" required />
      <datalist id="seminar-timezones">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
    </>
  );
}
