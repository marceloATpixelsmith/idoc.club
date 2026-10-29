import 'server-only';

import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { emailButton, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { taggedSubject } from '@/lib/notifications/alert-severity';
import { enqueueOperationalAlert } from '@/lib/notifications/operational-alert-outbox';

type CaseCandidate = {
  issue_key: string; profile_id: number | null; kind: string; severity: string; title: string;
  evidence: Record<string, unknown>;
};
export type MembershipHealthCase = {
  id: number; issue_key: string; profile_id: number | null; kind: string; severity: string;
  title: string; evidence: Record<string, unknown>; status: string; first_seen_at: string;
  last_seen_at: string; assigned_to_user_id: number | null; assigned_email: string | null;
  resolution_note: string | null; resolved_at: string | null;
};

// A CASE REMAINS OPEN UNTIL A HUMAN RESOLVES IT. REPEATED SCANS REUSE
// THE SAME ISSUE KEY; A CLOSED CASE IS NOT SILENTLY REOPENED OR ERASED.
export async function scanMembershipHealthCases(now = new Date()) {
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const [candidates, decline, duplicate, anomaly] = await Promise.all([
    client<CaseCandidate[]>`
      select 'notice:' || o.id::text as issue_key, o.profile_id,
        'notice_delivery_failed'::text as kind, 'high'::text as severity,
        'Renewal notice exhausted delivery attempts'::text as title,
        jsonb_build_object('outboxId',o.id,'noticeKind',o.kind,'error',o.last_error_code) as evidence
      from notification_outbox o
      where o.kind in ('membership.renewal_reminder','membership.expiration_reminder','membership.grace_reminder')
        and o.dead_lettered_at is not null and o.created_at >= ${since}::timestamptz
      union all
      select 'brevo:' || d.id::text, o.profile_id,
        'provider_delivery_failure', 'high', 'Brevo rejected or bounced a renewal notice',
        jsonb_build_object('deliveryLogId',d.id,'outboxId',o.id,'providerStatus',d.status)
      from email_delivery_log d join notification_outbox o
        on d.message_ref = o.kind || '-' || o.id::text
      where o.kind in ('membership.renewal_reminder','membership.expiration_reminder','membership.grace_reminder')
        and d.status in ('hard_bounced','blocked','invalid','error','spam')
        and d.sent_at >= ${since}::timestamptz
      union all
      select 'stripe:' || f.kind || ':' || coalesce(f.external_subscription_id, f.external_customer_id, f.profile_id::text, f.id::text),
        f.profile_id, f.kind,
        case when f.kind in ('status_conflict','orphaned_subscription') then 'critical' else 'high' end,
        f.summary, jsonb_build_object('findingId', f.id, 'kind', f.kind)
      from reconciliation_findings f
      where f.kind in ('status_conflict','orphaned_subscription','repeated_failure','pending_schedule_conflict')
      union all
      select 'checkout:' || s.profile_id::text || ':' || (s.created_at at time zone 'UTC')::date::text,
        s.profile_id, 'repeated_checkout_failure', 'high',
        'Multiple unsuccessful membership checkouts',
        jsonb_build_object('failedAttempts',count(*)::int,'date',(s.created_at at time zone 'UTC')::date)
      from membership_checkout_sessions s
      where s.status='failed' and s.created_at >= ${since}::timestamptz
      group by s.profile_id,(s.created_at at time zone 'UTC')::date
      having count(*) >= 3
      limit 500
    `,
    client<CaseCandidate[]>`
      select 'entitlement:' || p.id::text as issue_key, p.profile_id,
        'payment_without_entitlement' as kind, 'critical' as severity,
        'Recorded membership payment after the current paid-through date' as title,
        jsonb_build_object('paymentId',p.id,'paidAt',p.paid_at,'currentExpiration',m.valid_until) as evidence
      from payments p
      join lateral (
        select valid_until from memberships m where m.profile_id=p.profile_id
        order by valid_until desc, id desc limit 1
      ) m on true
      where p.source not in ('legacy_import','complimentary')
        and p.paid_at >= ${since}::timestamptz
        and p.paid_at::date > m.valid_until + 5
      order by p.paid_at desc limit 200
    `,
    client<CaseCandidate[]>`
      select 'duplicate:' || p.id::text || ':' || q.id::text as issue_key,
        p.profile_id, 'possible_duplicate_payment' as kind, 'critical' as severity,
        'Two separate membership payments recorded within five minutes' as title,
        jsonb_build_object('paymentIds',jsonb_build_array(p.id,q.id),'paidAt',p.paid_at) as evidence
      from payments p join payments q on q.profile_id=p.profile_id and q.id>p.id
        and q.paid_at between p.paid_at - interval '5 minutes' and p.paid_at + interval '5 minutes'
        and q.amount_cents=p.amount_cents
      where p.source not in ('legacy_import','complimentary')
        and q.source not in ('legacy_import','complimentary')
        and p.paid_at >= ${since}::timestamptz
      limit 200
    `,
    client<CaseCandidate[]>`
      with current_period as (
        select count(*)::int attempts, count(*) filter (where status='completed')::int completed
        from membership_checkout_sessions where created_at >= ${new Date(now.getTime()-14*86_400_000).toISOString()}::timestamptz
      ), prior_period as (
        select count(*)::int attempts, count(*) filter (where status='completed')::int completed
        from membership_checkout_sessions where created_at >= ${new Date(now.getTime()-28*86_400_000).toISOString()}::timestamptz
          and created_at < ${new Date(now.getTime()-14*86_400_000).toISOString()}::timestamptz
      )
      select 'checkout-conversion:' || ${now.toISOString().slice(0,10)}::text as issue_key,
        null::int as profile_id, 'checkout_conversion_drop'::text as kind, 'high'::text as severity,
        'Checkout completion rate dropped substantially against the preceding 14 days'::text as title,
        jsonb_build_object('currentAttempts',c.attempts,'currentCompleted',c.completed,'priorAttempts',p.attempts,'priorCompleted',p.completed) as evidence
      from current_period c cross join prior_period p
      where c.attempts >= 20 and p.attempts >= 20
        and c.completed::numeric/c.attempts < p.completed::numeric/p.attempts - 0.20
    `,
  ]);
  const issues = [...candidates, ...decline, ...duplicate, ...anomaly];
  let created = 0;
  for (const item of issues) {
    const inserted = await client<{ id: number }[]>`
      insert into membership_health_cases
        (issue_key, profile_id, kind, severity, title, evidence, first_seen_at, last_seen_at, updated_at)
      values (${item.issue_key},${item.profile_id},${item.kind},${item.severity},
        ${item.title},${JSON.stringify(item.evidence)}::jsonb,now(),now(),now())
      on conflict (issue_key) do nothing returning id
    `;
    if (inserted.length) created++;
    else await client`
      update membership_health_cases set last_seen_at=now(),
        evidence=${JSON.stringify(item.evidence)}::jsonb, updated_at=now()
      where issue_key=${item.issue_key} and status in ('new','investigating')
    `;
  }
  const criticalNew = issues.filter((item) => item.severity === 'critical').length;
  if (created > 0 && !memberCommunicationsDisabled()) {
    const url = new URL('/admin/membership-health?tab=issues', baseUrlForServer()).toString();
    await enqueueOperationalAlert({
      bodyHtml: renderTransactionalEmail({
        heading: 'Membership Health attention',
        bodyHtml: `<p>New renewal investigation cases were detected by the automated watch. Review the Membership Health administrator dashboard. Confirm provider evidence and membership status before any financial correction.</p>${emailButton(url, 'Investigate renewal cases')}`,
      }),
      dedupeKey: `membership-health-cases:${now.toISOString().slice(0, 10)}`,
      kind: 'member_journey_attention',
      subject: taggedSubject(criticalNew ? 'member.journey_urgent' : 'member.journey_followup', 'IDOC: renewal cases need attention'),
    });
  }
  return { detected: issues.length, created };
}

export async function getMembershipHealthCases(): Promise<MembershipHealthCase[]> {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return client<MembershipHealthCase[]>`
    select c.id, c.issue_key, c.profile_id, c.kind, c.severity,
      c.title, c.evidence, c.status, c.first_seen_at::text,
      c.last_seen_at::text, c.assigned_to_user_id,
      u.email as assigned_email, c.resolution_note, c.resolved_at::text
    from membership_health_cases c
    left join users u on u.id=c.assigned_to_user_id
    order by case when c.status in ('new','investigating') then 0 else 1 end,
      case when c.severity='critical' then 0 when c.severity='high' then 1 else 2 end,
      c.last_seen_at desc
    limit 2000
  `;
}
