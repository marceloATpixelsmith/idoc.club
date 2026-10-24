import { timingSafeEqual } from 'node:crypto';

// Pure helpers for the read-only cron-monitor endpoint (app/api/internal/cron-monitor). Kept free of database and
// server-only imports so they can be unit tested directly.

export const MONITOR_MAX_DAYS = 30;
export const MONITOR_MAX_NOTICES = 200;

// Kinds the renewal workflow produces; every other outbox kind (seminar confirmations and so on) is reported as "other".
export const RENEWAL_NOTICE_KINDS = [
  'membership.renewal_reminder',
  'membership.expiration_reminder',
  'membership.grace_reminder',
  'membership.grace_expired',
  'membership.payment_failed',
] as const;

/** First character, then ***, then the domain. Anything that does not look like an address is fully hidden. */
export function maskRecipient(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return '***';
  return `${value[0]}***${value.slice(at)}`;
}

export function boundedInteger(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || !/^\d{1,4}$/.test(raw)) return fallback;
  return Math.min(max, Math.max(min, Number(raw)));
}

export type DailyCount = { date: string; renewal: number; other: number };

/** One entry per UTC day for the last `days` days ending at `now`, with zeros where the database returned no row. */
export function fillDailyCounts(rows: ReadonlyArray<{ day: string; renewal: number; other: number }>, days: number, now: Date): DailyCount[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const result: DailyCount[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today - offset * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(date);
    result.push({ date, renewal: row?.renewal ?? 0, other: row?.other ?? 0 });
  }
  return result;
}

/** Constant-time comparison of the presented bearer token with the configured one. */
export function bearerMatches(header: string | null, expected: string): boolean {
  const supplied = Buffer.from(header?.replace(/^Bearer /, '') ?? '');
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

export function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
