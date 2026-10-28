import 'server-only';

import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

export type HealthRange = { from?: string; to?: string };
export type RenewalCycle = {
  profile_id: number; member: string; email: string; expires_on: string; status: string;
  imported: boolean; classification: string; notice_count: number; notice_sent: number;
  last_notice: string | null; payment_count: number; last_payment: string | null;
  checkout_count: number; failed_checkout_count: number; notice_failure_count: number;
};
export type RenewalNotice = {
  id: number; profile_id: number; member: string; email: string; kind: string;
  created_at: string; sent_at: string | null; status: string; paid_after: boolean;
};
export type HealthFinding = {
  id: number; profile_id: number | null; member: string; kind: string;
  summary: string; created_at: string;
};
export type HealthReport = {
  range: HealthRange; cycles: RenewalCycle[]; notices: RenewalNotice[];
  findings: HealthFinding[]; checkoutAttempts: number; completedCheckouts: number;
  payments: number; pendingNotices: number; bouncedNotices: number;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const NOTICE_KINDS = ['membership.renewal_reminder', 'membership.expiration_reminder', 'membership.grace_reminder'];

export function parseHealthRange(from?: string, to?: string): HealthRange {
  for (const value of [from, to]) {
    if (value !== undefined && (!DATE_KEY.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)) {
      throw new Error('Invalid date range. Choose valid calendar dates.');
    }
  }
  if (from && to && from > to) throw new Error('Start date must be on or before end date.');
  return { from, to };
}

// ALL COUNTS COME FROM STORED EVIDENCE. A CHECKOUT ATTEMPT OR AN OUTBOX SEND
// IS NOT A PAYMENT OR PROOF OF EMAIL DELIVERY. A PAYMENT IS NOT PROOF OF
// MEMBERSHIP ENTITLEMENT. THIS REPORT NEVER WRITES TO BILLING RECORDS.
export async function getMembershipHealthReport(range: HealthRange): Promise<HealthReport> {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const from = range.from ?? '1900-01-01';
  const to = range.to ?? '9999-12-31';
  const [cycles, notices, findings, checkoutTotals, paymentTotals, noticeTotals] = await Promise.all([
    client<RenewalCycle[]>`
      with cycles as (
        select distinct on (m.profile_id, m.valid_until)
          m.profile_id, m.valid_until, m.status, m.membership_type
        from memberships m
        where m.valid_until between ${from}::date and ${to}::date
        order by m.profile_id, m.valid_until, m.id desc
      )
      select c.profile_id, trim(concat(p.first_name, ' ', p.last_name)) as member,
        u.email, c.valid_until::text as expires_on, c.status,
        (p.legacy_wp_user_id is not null) as imported,
        c.membership_type as classification,
        (select count(*)::int from notification_outbox o
          where o.profile_id = c.profile_id
          and o.kind = any(${NOTICE_KINDS}::text[])
          and o.created_at >= (c.valid_until - interval '45 days')
          and o.created_at < (c.valid_until + interval '6 days')) as notice_count,
        (select count(*)::int from notification_outbox o
          where o.profile_id = c.profile_id and o.kind = any(${NOTICE_KINDS}::text[])
          and o.sent_at is not null
          and o.created_at >= (c.valid_until - interval '45 days')
          and o.created_at < (c.valid_until + interval '6 days')) as notice_sent,
        (select max(o.sent_at)::text from notification_outbox o
          where o.profile_id = c.profile_id and o.kind = any(${NOTICE_KINDS}::text[])
          and o.created_at >= (c.valid_until - interval '45 days')
          and o.created_at < (c.valid_until + interval '6 days')) as last_notice,
        (select count(*)::int from payments pay
          where pay.profile_id = c.profile_id and pay.source <> 'legacy_import'
          and pay.paid_at >= (c.valid_until - interval '45 days')
          and pay.paid_at < (c.valid_until + interval '36 days')) as payment_count,
        (select max(pay.paid_at)::text from payments pay
          where pay.profile_id = c.profile_id and pay.source <> 'legacy_import'
          and pay.paid_at >= (c.valid_until - interval '45 days')
          and pay.paid_at < (c.valid_until + interval '36 days')) as last_payment,
        (select count(*)::int from membership_checkout_sessions s
          where s.profile_id = c.profile_id and s.created_at >= (c.valid_until - interval '45 days')
          and s.created_at < (c.valid_until + interval '36 days')) as checkout_count,
        (select count(*)::int from membership_checkout_sessions s
          where s.profile_id = c.profile_id and s.status = 'failed'
          and s.created_at >= (c.valid_until - interval '45 days')
          and s.created_at < (c.valid_until + interval '36 days')) as failed_checkout_count,
        (select count(*)::int from notification_outbox o
          where o.profile_id = c.profile_id and o.kind = any(${NOTICE_KINDS}::text[])
          and (o.dead_lettered_at is not null or o.last_error_code is not null)
          and o.created_at >= (c.valid_until - interval '45 days')
          and o.created_at < (c.valid_until + interval '6 days')) as notice_failure_count
      from cycles c join profiles p on p.id = c.profile_id
      join users u on u.id = p.user_id
      order by c.valid_until desc, c.profile_id
      limit 2000
    `,
    client<RenewalNotice[]>`
      select o.id, p.id as profile_id, trim(concat(p.first_name, ' ', p.last_name)) as member,
        u.email, o.kind, o.created_at::text, o.sent_at::text,
        case when o.dead_lettered_at is not null then 'Failed'
          when o.sent_at is not null then 'Sent to provider'
          when o.last_error_code is not null then 'Retrying'
          else 'Pending' end as status,
        exists(select 1 from payments pay where pay.profile_id = p.id
          and pay.source <> 'legacy_import' and pay.paid_at >= o.created_at
          and pay.paid_at < o.created_at + interval '90 days') as paid_after
      from notification_outbox o
      join profiles p on p.id = o.profile_id join users u on u.id = p.user_id
      where o.kind = any(${NOTICE_KINDS}::text[])
        and o.created_at >= ${from}::date
        and o.created_at < (${to}::date + interval '1 day')
      order by o.created_at desc limit 2000
    `,
    // UNRESOLVED RECONCILIATION FINDINGS ARE NOT DATE-FILTERED: OLD, OPEN
    // INCIDENTS MUST NOT DISAPPEAR FROM THE ADMIN'S ATTENTION.
    client<HealthFinding[]>`
      select f.id, f.profile_id, coalesce(trim(concat(p.first_name, ' ', p.last_name)), 'Unlinked Stripe record') as member,
        f.kind, f.summary, f.created_at::text
      from reconciliation_findings f left join profiles p on p.id = f.profile_id
      where f.kind in ('repeated_failure','status_conflict','orphaned_subscription','pending_schedule_conflict')
      order by f.created_at desc limit 500
    `,
    client<{ attempts: number; completed: number }[]>`
      select count(*)::int as attempts,
        count(*) filter (where status = 'completed')::int as completed
      from membership_checkout_sessions
      where created_at >= ${from}::date and created_at < (${to}::date + interval '1 day')
    `,
    client<{ count: number }[]>`
      select count(*)::int as count from payments
      where source <> 'legacy_import'
        and paid_at >= ${from}::date and paid_at < (${to}::date + interval '1 day')
    `,
    client<{ pending: number; bounced: number }[]>`
      select count(*) filter (where sent_at is null and dead_lettered_at is null)::int as pending,
        count(*) filter (where dead_lettered_at is not null)::int as bounced
      from notification_outbox where kind = any(${NOTICE_KINDS}::text[])
        and created_at >= ${from}::date and created_at < (${to}::date + interval '1 day')
    `,
  ]);
  return {
    range, cycles, notices, findings,
    checkoutAttempts: Number(checkoutTotals[0]?.attempts ?? 0),
    completedCheckouts: Number(checkoutTotals[0]?.completed ?? 0),
    payments: Number(paymentTotals[0]?.count ?? 0),
    pendingNotices: Number(noticeTotals[0]?.pending ?? 0),
    bouncedNotices: Number(noticeTotals[0]?.bounced ?? 0),
  };
}
