import 'server-only';

import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { OPEN_SUBSCRIPTION_STATUSES } from '@/lib/payments/pricing';
import { AUTO_RENEWAL_NOTICE_DAYS, GRACE_REMINDER_DAYS_BEFORE_END, NON_RENEWAL_EXPIRATION_NOTICE_DAYS } from '@/lib/payments/renewal';
import { brevoApiKeyForServer } from '@/lib/runtime/configuration';
import { tracedFetch } from '@/lib/observability/outbound-fetch';
import {
  checkAgainstBrevoLog, emailKindLabel, noticeSendDate, RENEWAL_NOTICE_KINDS, totalsByKind,
  type BrevoCheck, type BrevoEventName, type BrevoLogEvent, type KindTotals, type OutboxEmail,
} from './communications-report';

const WINDOW_DAYS = 7;
export const UPCOMING_DAYS = 28;
const BREVO_EVENTS: BrevoEventName[] = ['delivered', 'hardBounces', 'softBounces', 'blocked', 'spam', 'invalid', 'error'];
const BREVO_PAGE_SIZE = 500;
const BREVO_MAX_PAGES = 10;

export type SentRow = { brevo: BrevoCheck | null; email: string | null; kind: string; label: string; member: string; sentAt: Date | null; status: 'failed' | 'pending' | 'sent' };
export type UpcomingNotice = { email: string; kind: string; label: string; member: string; sendOn: string; targetDate: string };
export type CommunicationsReport = {
  brevoAvailable: boolean;
  from: Date;
  renewalRows: SentRow[];
  renewalTotals: KindTotals[];
  systemTotals: KindTotals[];
  to: Date;
  upcoming: UpcomingNotice[];
};

type OutboxRow = { dead_lettered_at: Date | null; email: string | null; first_name: string | null; id: number; kind: string; last_name: string | null; sent_at: Date | null };

/** Delivery results from Brevo's transactional log for the window, or null when it cannot be read (no key, network, non-2xx). */
async function fetchBrevoEvents(from: Date, to: Date): Promise<BrevoLogEvent[] | null> {
  let apiKey: string;
  try { apiKey = brevoApiKeyForServer(); } catch { return null; }
  const startDate = from.toISOString().slice(0, 10);
  const endDate = to.toISOString().slice(0, 10);
  try {
    const perEvent = await Promise.all(BREVO_EVENTS.map(async (event) => {
      const events: BrevoLogEvent[] = [];
      for (let page = 0; page < BREVO_MAX_PAGES; page += 1) {
        const url = `https://api.brevo.com/v3/smtp/statistics/events?event=${event}&startDate=${startDate}&endDate=${endDate}&limit=${BREVO_PAGE_SIZE}&offset=${page * BREVO_PAGE_SIZE}&sort=asc`;
        const response = await tracedFetch('brevo', url, { headers: { accept: 'application/json', 'api-key': apiKey }, method: 'GET', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('brevo_log_unavailable');
        const body = await response.json() as { events?: { date?: string; email?: string }[] };
        const batch = body.events ?? [];
        for (const item of batch) {
          const at = item.date ? new Date(item.date) : null;
          if (item.email && at && !Number.isNaN(at.getTime())) events.push({ at, email: item.email, event });
        }
        if (batch.length < BREVO_PAGE_SIZE) break;
      }
      return events;
    }));
    return perEvent.flat();
  } catch {
    return null;
  }
}

function memberName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ') || '—';
}

export async function getCommunicationsReport(now: Date = new Date()): Promise<CommunicationsReport> {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const from = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + UPCOMING_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [outbox, accountDeliveries, upcoming, events] = await Promise.all([
    client<OutboxRow[]>`select o.id, o.kind, o.sent_at, o.dead_lettered_at, coalesce(o.payload->>'to', u.email) as email, p.first_name, p.last_name
      from notification_outbox o left join profiles p on p.id = o.profile_id left join users u on u.id = p.user_id
      where o.kind not like 'stripe.%' and (o.sent_at >= ${from} or (o.sent_at is null and o.created_at >= ${from}))`,
    client<{ dead_lettered_at: Date | null; email: string | null; id: number; purpose: string; sent_at: Date | null; terminal_at: Date | null }[]>`
      select d.id, d.purpose, d.sent_at, d.dead_lettered_at, d.terminal_at, u.email
      from account_delivery_outbox d left join users u on u.id = d.user_id
      where d.terminal_at is null and (d.sent_at >= ${from} or (d.sent_at is null and d.created_at >= ${from}))`,
    client<{ email: string; first_name: string | null; kind: string; last_name: string | null; target_date: string }[]>`
      select * from (
        select 'membership.renewal_reminder' as kind, s.profile_id, u.email, p.first_name, p.last_name, s.current_period_end::text as target_date
        from subscriptions s join profiles p on p.id = s.profile_id join users u on u.id = p.user_id
        where s.status = 'active' and s.cancel_at_period_end = false
          and s.current_period_end between ${today}::date and ${today}::date + ${UPCOMING_DAYS + AUTO_RENEWAL_NOTICE_DAYS}::int
        union all
        select 'membership.renewal_reminder', r.profile_id, u2.email, p2.first_name, p2.last_name, r.effective_on::text
        from renewal_preferences r join profiles p2 on p2.id = r.profile_id join users u2 on u2.id = p2.user_id
        where r.pending_mode = 'recurring' and r.transition_state = 'pending_activation' and r.external_subscription_schedule_id is not null
          and r.effective_on between ${today}::date and ${today}::date + ${UPCOMING_DAYS + AUTO_RENEWAL_NOTICE_DAYS}::int
        union all
        select 'membership.expiration_reminder', m.profile_id, u3.email, p3.first_name, p3.last_name, m.valid_until::text
        from memberships m join profiles p3 on p3.id = m.profile_id join users u3 on u3.id = p3.user_id
        where m.status in ('active', 'complimentary')
          and m.valid_until between ${today}::date and ${today}::date + ${UPCOMING_DAYS + NON_RENEWAL_EXPIRATION_NOTICE_DAYS}::int
          and not exists (select 1 from subscriptions s2 where s2.profile_id = m.profile_id and s2.status = any(${[...OPEN_SUBSCRIPTION_STATUSES]}::text[]) and s2.cancel_at_period_end = false)
        union all
        select 'membership.grace_reminder', m2.profile_id, u4.email, p4.first_name, p4.last_name, coalesce(m2.grace_ends_on, m2.valid_until)::text
        from memberships m2 join profiles p4 on p4.id = m2.profile_id join users u4 on u4.id = p4.user_id
        where m2.status = 'grace' and coalesce(m2.grace_ends_on, m2.valid_until) > ${today}::date
      ) candidates
      where not exists (select 1 from notification_outbox o where o.dedupe_key = candidates.kind || ':' || candidates.profile_id || ':' || candidates.target_date)
      order by target_date, email`,
    fetchBrevoEvents(from, now),
  ]);

  const emails: (OutboxEmail & { label: string; member: string })[] = [
    ...outbox.map((row) => ({ deadLettered: row.dead_lettered_at !== null, email: row.email, id: `n${row.id}`, kind: row.kind, label: emailKindLabel(row.kind), member: memberName(row.first_name, row.last_name), sentAt: row.sent_at })),
    ...accountDeliveries.map((row) => ({ deadLettered: row.dead_lettered_at !== null, email: row.email, id: `a${row.id}`, kind: `account.${row.purpose}`, label: emailKindLabel(`account.${row.purpose}`), member: '—', sentAt: row.sent_at })),
  ];
  const checks = checkAgainstBrevoLog(emails.filter((row) => row.sentAt).map((row) => ({ email: row.email, id: row.id, sentAt: row.sentAt as Date })), events);
  const isRenewal = (kind: string) => (RENEWAL_NOTICE_KINDS as readonly string[]).includes(kind);
  const renewalEmails = emails.filter((row) => isRenewal(row.kind));
  const systemEmails = emails.filter((row) => !isRenewal(row.kind));

  const renewalRows: SentRow[] = renewalEmails.map((row) => ({
    brevo: row.sentAt ? checks.get(row.id) ?? 'not_found' : null, email: row.email, kind: row.kind, label: row.label, member: row.member, sentAt: row.sentAt,
    status: (row.sentAt ? 'sent' : row.deadLettered ? 'failed' : 'pending') as SentRow['status'],
  })).sort((left, right) => (right.sentAt?.getTime() ?? 0) - (left.sentAt?.getTime() ?? 0));

  const noticeDays: Record<string, number> = { 'membership.expiration_reminder': NON_RENEWAL_EXPIRATION_NOTICE_DAYS, 'membership.grace_reminder': GRACE_REMINDER_DAYS_BEFORE_END, 'membership.renewal_reminder': AUTO_RENEWAL_NOTICE_DAYS };
  const upcomingNotices: UpcomingNotice[] = upcoming
    .map((row) => ({ email: row.email, kind: row.kind, label: emailKindLabel(row.kind), member: memberName(row.first_name, row.last_name), sendOn: noticeSendDate(row.target_date, noticeDays[row.kind] ?? 0, today), targetDate: row.target_date }))
    .filter((row) => row.sendOn <= horizon)
    .sort((left, right) => left.sendOn.localeCompare(right.sendOn) || left.member.localeCompare(right.member));

  return {
    brevoAvailable: events !== null, from, renewalRows,
    renewalTotals: totalsByKind(renewalEmails, checks), systemTotals: totalsByKind(systemEmails, checks), to: now, upcoming: upcomingNotices,
  };
}
