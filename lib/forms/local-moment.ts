// Pure helpers for the shared DateTimePicker (components/forms/date-time-picker.tsx); kept free of React so they can be unit tested.

const pad = (value: number) => String(value).padStart(2, '0');
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** A moment in the viewer's local time as `YYYY-MM-DDTHH:MM` in UTC (what the server and Stripe work in). Empty when the date is missing or not a real day. */
export function localMomentToUtc(isoDate: string, hour: string, minute: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return '';
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (dayKey(day) !== isoDate) return '';
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(hour), Number(minute)).toISOString().slice(0, 16);
}

/** The calendar days a picker may offer: today and the `days` days before it (local calendar days). */
export function lastDaysRange(days: number, now: Date = new Date()): { max: string; min: string } {
  return { max: dayKey(now), min: dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)) };
}
