import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';

export type RevenueFilters = { from?: string; origin?: 'manual' | 'stripe'; source?: string; to?: string };

function dates(input: RevenueFilters) {
  const today = new Date();
  const to = input.to ?? today.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  const from = input.from ?? start.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('Choose a valid date range.');
  return { from, to };
}

export async function getRevenueReport(input: RevenueFilters = {}) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  const range = dates(input);
  const conditions = [sql`paid_at >= ${range.from}::date`, sql`paid_at < (${range.to}::date + interval '1 day')`, sql`source <> 'complimentary'`];
  if (input.source) conditions.push(sql`source = ${input.source}`);
  if (input.origin === 'stripe') conditions.push(sql`source in ('stripe_recurring','stripe_one_time')`);
  if (input.origin === 'manual') conditions.push(sql`source not in ('stripe_recurring','stripe_one_time','complimentary')`);
  const where = sql.join(conditions, sql` and `);
  const [summary, bySource, overTime] = await Promise.all([
    db.execute<{ averageCents: number; currency: string; paymentCount: number; totalCents: number }>(sql`select currency,sum(amount_cents)::int "totalCents",count(*)::int "paymentCount",round(avg(amount_cents))::int "averageCents" from idoc.payments where ${where} group by currency order by currency`),
    db.execute<{ currency: string; source: string; totalCents: number }>(sql`select currency,source,sum(amount_cents)::int "totalCents" from idoc.payments where ${where} group by currency,source order by currency,source`),
    db.execute<{ currency: string; month: string; totalCents: number }>(sql`select currency,to_char(date_trunc('month',paid_at at time zone 'UTC'),'YYYY-MM') month,sum(amount_cents)::int "totalCents" from idoc.payments where ${where} group by currency,date_trunc('month',paid_at at time zone 'UTC') order by date_trunc('month',paid_at at time zone 'UTC'),currency`),
  ]);
  return { bySource: [...bySource], overTime: [...overTime], range, summary: [...summary] };
}
