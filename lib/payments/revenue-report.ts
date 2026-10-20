import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';

// Next.js searchParams values are string | string[] | undefined at runtime (a repeated query key
// becomes an array) regardless of a narrower page-level annotation, so every filter accepts that
// real shape and resolves an array to its first value before any string method or SQL parameter
// use -- matching the convention already used by lib/news/articles.ts, lib/seminars/seminars.ts,
// lib/support/inbox.ts, and lib/membership/admin-memberships.ts.
type RawFilterValue = string | string[] | undefined;
export type RevenueFilters = { from?: RawFilterValue; origin?: RawFilterValue; source?: RawFilterValue; to?: RawFilterValue };
function firstValue(value: RawFilterValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Distinct from any other failure (an AuthorizationError, a database error) so the page can catch
// and render exactly this one expected, user-facing validation message inline, and let every other
// exception -- which could carry SQL/schema/infrastructure detail unsafe to show a browser --
// propagate to the normal server error path instead.
export class RevenueRangeError extends Error {
  constructor() {
    super('Choose a valid date range.');
    this.name = 'RevenueRangeError';
  }
}

// The default view is all time: with neither bound supplied there is no date restriction at all. A
// lone start date runs through today; a lone end date has no lower bound.
function dates(input: RevenueFilters): { from: string | null; to: string | null } {
  const rawFrom = firstValue(input.from) || undefined;
  const rawTo = firstValue(input.to) || undefined;
  if (!rawFrom && !rawTo) return { from: null, to: null };
  const to = rawTo ?? new Date().toISOString().slice(0, 10);
  const from = rawFrom ?? null;
  if ((from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || (from !== null && from > to)) throw new RevenueRangeError();
  return { from, to };
}

// Payment-source filter values offered by the UI. "stripe" covers every Stripe-recorded payment,
// whether the webhook recorded it or an administrator registered it manually.
export const REVENUE_SOURCE_FILTERS = ['stripe', 'bank_transfer', 'cash'] as const;

type RevenueReport = Awaited<ReturnType<typeof computeRevenueReport>>;
const REPORT_CACHE_MAX_ENTRIES = 20;
const reportCache = new Map<string, { at: number; report: RevenueReport }>();

/** `cacheSeconds` lets a summary view (the Admin Dashboard's overview) reuse one report per server instance for a short time instead
 * of running three aggregates over every payment on each load. Authorization always runs first and is never cached. The Revenue page
 * passes nothing and stays live. */
export async function getRevenueReport(input: RevenueFilters = {}, options: { cacheSeconds?: number } = {}) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  const range = dates(input);
  const source = firstValue(input.source);
  const origin = firstValue(input.origin);
  if (!options.cacheSeconds) return computeRevenueReport(range, source, origin);
  const key = JSON.stringify([range, source ?? null, origin ?? null]);
  const hit = reportCache.get(key);
  if (hit && Date.now() - hit.at < options.cacheSeconds * 1000) return hit.report;
  const report = await computeRevenueReport(range, source, origin);
  if (reportCache.size >= REPORT_CACHE_MAX_ENTRIES) reportCache.clear();
  reportCache.set(key, { at: Date.now(), report });
  return report;
}

export function resetRevenueReportCacheForTests() { reportCache.clear(); }

async function computeRevenueReport(range: { from: string | null; to: string | null }, source: string | undefined, origin: string | undefined) {
  const conditions = [sql`source <> 'complimentary'`];
  if (range.from) conditions.push(sql`paid_at >= (${range.from}::date::timestamp at time zone 'UTC')`);
  if (range.to) conditions.push(sql`paid_at < ((${range.to}::date::timestamp at time zone 'UTC') + interval '1 day')`);
  if (source === 'stripe') conditions.push(sql`source in ('stripe_recurring','stripe_one_time','stripe_manual')`);
  else if (source === 'bank_transfer' || source === 'cash') conditions.push(sql`source = ${source}`);
  if (origin === 'stripe') conditions.push(sql`source in ('stripe_recurring','stripe_one_time','stripe_manual')`);
  if (origin === 'manual') conditions.push(sql`source not in ('stripe_recurring','stripe_one_time','stripe_manual','complimentary')`);
  const where = sql.join(conditions, sql` and `);
  const [summary, bySource, overTime] = await Promise.all([
    db.execute<{ averageCents: number; currency: string; manualCents: number; paymentCount: number; stripeCents: number; totalCents: number }>(sql`select currency,sum(amount_cents)::int "totalCents",count(*)::int "paymentCount",round(avg(amount_cents))::int "averageCents",
      coalesce(sum(amount_cents) filter (where source in ('stripe_recurring','stripe_one_time','stripe_manual')),0)::int "stripeCents",
      coalesce(sum(amount_cents) filter (where source not in ('stripe_recurring','stripe_one_time','stripe_manual','complimentary')),0)::int "manualCents"
      from payments where ${where} group by currency order by currency`),
    db.execute<{ currency: string; source: string; totalCents: number }>(sql`select currency,source,sum(amount_cents)::int "totalCents" from payments where ${where} group by currency,source order by currency,source`),
    db.execute<{ currency: string; month: string; totalCents: number }>(sql`select currency,to_char(date_trunc('month',paid_at at time zone 'UTC'),'YYYY-MM') as "month",sum(amount_cents)::int "totalCents" from payments where ${where} group by currency,date_trunc('month',paid_at at time zone 'UTC') order by date_trunc('month',paid_at at time zone 'UTC'),currency`),
  ]);
  return { bySource: [...bySource], overTime: [...overTime], range, summary: [...summary] };
}
