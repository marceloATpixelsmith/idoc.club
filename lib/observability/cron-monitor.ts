import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { fillDailyCounts, isoOrNull, maskRecipient, RENEWAL_NOTICE_KINDS } from './cron-monitor-core';

// Read-only snapshot of notification_outbox for the cron monitoring dashboard. Reads this deployment's own schema only,
// returns no payload contents, and masks every recipient address.
const renewalKinds = sql.join(RENEWAL_NOTICE_KINDS.map((kind) => sql`${kind}`), sql`, `);

type SummaryRow = { total: number; sent: number; pending: number; dead: number; last_sent_at: unknown; oldest_pending_at: unknown };
type DailyRow = { day: string; renewal: number; other: number };
type NoticeRow = {
  id: number; kind: string; profile_id: number | null; created_at: unknown; sent_at: unknown;
  attempt_count: number; last_error_code: string | null; dead_lettered_at: unknown; recipient: unknown;
};

export async function readCronMonitor(days: number, noticeLimit: number, now: Date = new Date()) {
  const [summary] = await db.execute(sql`
    select count(*)::int as total,
      (count(*) filter (where sent_at is not null))::int as sent,
      (count(*) filter (where sent_at is null and dead_lettered_at is null))::int as pending,
      (count(*) filter (where dead_lettered_at is not null))::int as dead,
      max(sent_at) as last_sent_at,
      min(created_at) filter (where sent_at is null and dead_lettered_at is null) as oldest_pending_at
    from notification_outbox
  `) as unknown as SummaryRow[];
  const dailyRows = await db.execute(sql`
    select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day,
      (count(*) filter (where kind in (${renewalKinds})))::int as renewal,
      (count(*) filter (where kind not in (${renewalKinds})))::int as other
    from notification_outbox
    where created_at >= date_trunc('day', now() at time zone 'UTC') - make_interval(days => ${days - 1})
    group by 1
  `) as unknown as DailyRow[];
  const noticeRows = await db.execute(sql`
    select id, kind, profile_id, created_at, sent_at, attempt_count, last_error_code, dead_lettered_at, payload->>'to' as recipient
    from notification_outbox
    where created_at >= date_trunc('day', now() at time zone 'UTC') - make_interval(days => ${days - 1})
    order by id desc
    limit ${noticeLimit}
  `) as unknown as NoticeRow[];
  return {
    generatedAt: now.toISOString(),
    outbox: {
      total: summary?.total ?? 0,
      sent: summary?.sent ?? 0,
      pending: summary?.pending ?? 0,
      dead: summary?.dead ?? 0,
      lastSentAt: isoOrNull(summary?.last_sent_at),
      oldestPendingAt: isoOrNull(summary?.oldest_pending_at),
    },
    daily: fillDailyCounts(dailyRows, days, now),
    notices: noticeRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      profileId: row.profile_id,
      to: maskRecipient(row.recipient),
      createdAt: isoOrNull(row.created_at),
      sentAt: isoOrNull(row.sent_at),
      attempts: row.attempt_count,
      errorCode: row.last_error_code,
      deadLetteredAt: isoOrNull(row.dead_lettered_at),
    })),
  };
}
