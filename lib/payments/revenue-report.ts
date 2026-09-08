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

function dates(input: RevenueFilters) {
  const today = new Date();
  const to = firstValue(input.to) ?? today.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  const from = firstValue(input.from) ?? start.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new RevenueRangeError();
  return { from, to };
}

export async function getRevenueReport(input: RevenueFilters = {}) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  const range = dates(input);
  const source = firstValue(input.source);
  const origin = firstValue(input.origin);
  const conditions = [sql`paid_at >= (${range.from}::date::timestamp at time zone 'UTC')`, sql`paid_at < ((${range.to}::date::timestamp at time zone 'UTC') + interval '1 day')`, sql`source <> 'complimentary'`];
  if (source) conditions.push(sql`source = ${source}`);
  if (origin === 'stripe') conditions.push(sql`source in ('stripe_recurring','stripe_one_time')`);
  if (origin === 'manual') conditions.push(sql`source not in ('stripe_recurring','stripe_one_time','complimentary')`);
  const where = sql.join(conditions, sql` and `);
  const [summary, bySource, overTime] = await Promise.all([
    db.execute<{ averageCents: number; currency: string; manualCents: number; paymentCount: number; stripeCents: number; totalCents: number }>(sql`select currency,sum(amount_cents)::int "totalCents",count(*)::int "paymentCount",round(avg(amount_cents))::int "averageCents",
      coalesce(sum(amount_cents) filter (where source in ('stripe_recurring','stripe_one_time')),0)::int "stripeCents",
      coalesce(sum(amount_cents) filter (where source not in ('stripe_recurring','stripe_one_time','complimentary')),0)::int "manualCents"
      from idoc.payments where ${where} group by currency order by currency`),
    db.execute<{ currency: string; source: string; totalCents: number }>(sql`select currency,source,sum(amount_cents)::int "totalCents" from idoc.payments where ${where} group by currency,source order by currency,source`),
    db.execute<{ currency: string; month: string; totalCents: number }>(sql`select currency,to_char(date_trunc('month',paid_at at time zone 'UTC'),'YYYY-MM') month,sum(amount_cents)::int "totalCents" from idoc.payments where ${where} group by currency,date_trunc('month',paid_at at time zone 'UTC') order by date_trunc('month',paid_at at time zone 'UTC'),currency`),
  ]);
  return { bySource: [...bySource], overTime: [...overTime], range, summary: [...summary] };
}
