import 'server-only';

import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

export type MemberJourneyConcernKind =
  | 'activation_repeated'
  | 'activation_delivery_stuck'
  | 'login_code_repeated'
  | 'onboarding_incomplete'
  | 'renewal_delivery_stuck'
  | 'renewal_followup';

export type MemberJourneyConcern = {
  kind: MemberJourneyConcernKind;
  userId: number;
  profileId: number | null;
  member: string;
  email: string;
  occurredAt: Date;
  count: number;
  note: string;
};

type MemberRow = { email: string; first_name: string | null; last_name: string | null; profile_id: number | null; user_id: number };
type TimedRow = MemberRow & { occurred_at: Date | string; count: number };

function concern(kind: MemberJourneyConcernKind, row: TimedRow, note: string): MemberJourneyConcern {
  return {
    kind, userId: row.user_id, profileId: row.profile_id,
    member: [row.first_name, row.last_name].filter(Boolean).join(' ') || '—',
    email: row.email, occurredAt: new Date(row.occurred_at),
    count: Number(row.count), note,
  };
}

// MEMBER JOURNEY SCANS ARE READ-ONLY. EACH SIGNAL IDENTIFIES AN OBSERVABLE RISK,
// NOT PROOF OF USER ERROR, INBOX PLACEMENT, OR A FAILED FINANCIAL TRANSACTION.
export async function scanMemberJourneyConcerns(now = new Date()): Promise<MemberJourneyConcern[]> {
  const sinceHour = new Date(now.getTime() - 3_600_000).toISOString();
  const sinceWeek = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const sinceMonth = new Date(now.getTime() - 35 * 86_400_000).toISOString();
  const tooOld = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const stuck = new Date(now.getTime() - 30 * 60_000).toISOString();
  const expired = new Date(now.getTime() - 5 * 86_400_000).toISOString().slice(0, 10);

  const [repeatedActivations, stalledActivationLinks, repeatedCodes, onboarding, stalledRenewals, renewals] = await Promise.all([
    client<TimedRow[]>`
      select u.id user_id, u.email, p.id profile_id, p.first_name, p.last_name,
        max(d.created_at) occurred_at, count(*)::int as count
      from account_delivery_outbox d
      join users u on u.id=d.user_id
      left join profiles p on p.user_id=u.id
      where d.purpose='migration_activation' and d.created_at >= ${sinceWeek}::timestamptz
        and u.account_state='migrated_pending'
      group by u.id,u.email,p.id,p.first_name,p.last_name
      having count(*) >= 3
    `,
    client<TimedRow[]>`
      select u.id user_id, u.email, p.id profile_id, p.first_name,p.last_name,
        min(d.created_at) occurred_at, count(*)::int as count
      from account_delivery_outbox d
      join users u on u.id=d.user_id left join profiles p on p.user_id=u.id
      where d.purpose='migration_activation' and d.sent_at is null
        and d.dead_lettered_at is null and d.terminal_at is null
        and d.created_at <= ${stuck}::timestamptz
        and d.available_at <= ${now.toISOString()}::timestamptz
        and u.account_state='migrated_pending'
      group by u.id,u.email,p.id,p.first_name,p.last_name
    `,
    client<TimedRow[]>`
      select u.id user_id,u.email,p.id profile_id,p.first_name,p.last_name,
        a.last_at occurred_at,a.requests as count
      from (
        select c.user_id,min(c.created_at) first_at,max(c.created_at) last_at,count(*)::int requests
        from email_otp_codes c
        where c.user_id is not null and c.purpose='login_verification'
          and c.created_at >= ${sinceHour}::timestamptz
        group by c.user_id having count(*) >= 3
      ) a join users u on u.id=a.user_id
      join profiles p on p.user_id=u.id and p.legacy_wp_user_id is not null
      where u.account_state in ('migrated_pending','active','onboarding')
        and not exists (
          select 1 from auth_sessions s
          where s.user_id=u.id and s.authenticated_at >= a.first_at
        )
    `,
    client<TimedRow[]>`
      select u.id user_id,u.email,p.id profile_id,p.first_name,p.last_name,
        u.updated_at occurred_at,1::int as count
      from users u join profiles p on p.user_id=u.id and p.legacy_wp_user_id is not null
      where u.account_state='onboarding' and u.updated_at <= ${tooOld}::timestamptz
        and exists (select 1 from auth_sessions s where s.user_id=u.id and s.authenticated_at >= ${sinceWeek}::timestamptz)
    `,
    client<TimedRow[]>`
      select u.id user_id,u.email,p.id profile_id,p.first_name,p.last_name,
        min(o.created_at) occurred_at,count(*)::int as count
      from notification_outbox o join profiles p on p.id=o.profile_id
      join users u on u.id=p.user_id
      where o.kind in ('membership.renewal_reminder','membership.expiration_reminder','membership.grace_reminder')
        and o.sent_at is null and o.dead_lettered_at is null
        and o.created_at <= ${stuck}::timestamptz and o.available_at <= ${now.toISOString()}::timestamptz
      group by u.id,u.email,p.id,p.first_name,p.last_name
    `,
    client<TimedRow[]>`
      select u.id user_id,u.email,p.id profile_id,p.first_name,p.last_name,
        n.last_notice occurred_at,1::int as count
      from users u join profiles p on p.user_id=u.id and p.legacy_wp_user_id is not null
      join lateral (
        select m.status,m.valid_until from memberships m where m.profile_id=p.id
        order by m.valid_until desc,m.id desc limit 1
      ) m on true
      join lateral (
        select max(o.sent_at) last_notice
        from notification_outbox o
        where o.profile_id=p.id
          and o.kind in ('membership.expiration_reminder','membership.grace_reminder')
          and o.sent_at >= ${sinceMonth}::timestamptz
      ) n on n.last_notice is not null
      where m.status in ('expired','grace') and m.valid_until < ${expired}::date
        and not exists (
          select 1 from payments pay
          where pay.profile_id=p.id and pay.paid_at > n.last_notice
            and pay.source <> 'legacy_import'
        )
    `,
  ]);

  return [
    ...stalledActivationLinks.map((row) => concern('activation_delivery_stuck', row, 'Activation email queued for more than 30 minutes without being sent')),
    ...repeatedActivations.map((row) => concern('activation_repeated', row, 'Three or more activation requests in seven days; account still awaits activation')),
    ...repeatedCodes.map((row) => concern('login_code_repeated', row, 'Three or more login codes requested within one hour with no new successful session')),
    ...onboarding.map((row) => concern('onboarding_incomplete', row, 'Imported member signed in but onboarding remains incomplete after 48 hours')),
    ...stalledRenewals.map((row) => concern('renewal_delivery_stuck', row, 'Renewal notice queued for more than 30 minutes without being sent')),
    ...renewals.map((row) => concern('renewal_followup', row, 'Previously notified member remains expired or in grace beyond five days; follow-up only')),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

export async function getMemberJourneyConcerns(now = new Date()): Promise<MemberJourneyConcern[]> {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return scanMemberJourneyConcerns(now);
}
