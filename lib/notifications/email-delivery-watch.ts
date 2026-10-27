import 'server-only';

import { client } from '@/lib/db/drizzle';
import { brevoApiKeyForServer, baseUrlForServer } from '@/lib/runtime/configuration';
import { tracedFetch } from '@/lib/observability/outbound-fetch';
import { taggedSubject } from './alert-severity';
import { applyBrevoDeliveryEvent } from './email-delivery-log';
import { normalizeBrevoEventName, normalizeBrevoMessageId } from './email-delivery-log-core';
import {
  alertTier, AUTH_CODE_DEADLINE_MS, buildDeliveryProblemAlert, buildFloodSummaryAlert, buildRepeatRequestAlert, FINAL_DEADLINE_MS, GENERAL_DEADLINE_MS, HOURLY_ALERT_CAP,
  HOURLY_REPEAT_ALERT_CAP, MAX_ALERTS_PER_RUN, REPEAT_REQUEST_THRESHOLD, REPEAT_REQUEST_WINDOW_MS, WATCH_LOOKBACK_MS,
  type BrevoCheck, type DomainContext, type EventLine, type MemberRef, type RecentEmail,
} from './email-delivery-watch-core';
import { enqueueOperationalAlert } from './operational-alert-outbox';

// Reports an email that Brevo accepted but never delivered (and a member who keeps asking for codes that do not arrive) to
// IDOC_ADMIN_NOTIFICATION_EMAIL through the durable operational alert queue, at most once per email and tier. Runs inside the
// account-delivery cron every five minutes.

const BREVO_CHECK_TIMEOUT_MS = 10_000;

type LogRow = {
  account_state: string | null; delivered_at: Date | null; first_name: string | null; id: number; kind: string | null; last_name: string | null;
  message_ref: string | null; profile_id: number | null; provider_message_id: string | null; recipient_domain: string; recipient_email: string;
  sent_at: Date | string; status: string; status_at: Date | string; subject: string | null; user_id: number | null;
};
const toDate = (value: Date | string) => new Date(value);
const fullName = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(' ') || null;

async function alreadyQueued(dedupeKey: string): Promise<boolean> {
  const rows = await client`select 1 from operational_alert_outbox where dedupe_key=${dedupeKey} limit 1`;
  return rows.length > 0;
}

/** Asks Brevo's own log about one message and records what it reports, so a missing or misconfigured webhook can never cause a false
 * alarm (and a message Brevo did deliver is corrected here instead of alerted). Matching is by Brevo's message id, never by time. */
async function reconcileWithBrevo(row: LogRow, now: Date): Promise<BrevoCheck> {
  const messageId = row.provider_message_id;
  if (!messageId) return 'unavailable';
  let apiKey: string;
  try { apiKey = brevoApiKeyForServer(); } catch { return 'unavailable'; }
  const startDate = toDate(row.sent_at).toISOString().slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);
  try {
    const response = await tracedFetch('brevo', `https://api.brevo.com/v3/smtp/statistics/events?email=${encodeURIComponent(row.recipient_email)}&startDate=${startDate}&endDate=${endDate}&limit=100&sort=asc`, {
      headers: { accept: 'application/json', 'api-key': apiKey }, method: 'GET', signal: AbortSignal.timeout(BREVO_CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return 'unavailable';
    const body = await response.json() as { events?: { date?: string; event?: string; messageId?: string; reason?: string }[] };
    let found = 0;
    for (const item of body.events ?? []) {
      const event = normalizeBrevoEventName(item.event);
      const at = item.date ? new Date(item.date) : null;
      if (!event || !at || Number.isNaN(at.getTime()) || normalizeBrevoMessageId(item.messageId) !== messageId) continue;
      await applyBrevoDeliveryEvent({ event, messageId, occurredAt: at, reason: item.reason });
      found += 1;
    }
    return found > 0 ? 'events_found' : 'no_events';
  } catch {
    return 'unavailable';
  }
}

async function domainContext(domain: string, now: Date): Promise<DomainContext> {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const stuckBefore = new Date(now.getTime() - 5 * 60_000).toISOString();
  const [counts] = await client<{ delivered: number; not_delivered: number; total: number }[]>`
    select count(*)::int total, (count(*) filter (where status='delivered'))::int delivered,
      (count(*) filter (where status<>'delivered' and sent_at <= ${stuckBefore}::timestamptz))::int not_delivered
    from email_delivery_log where recipient_domain=${domain} and sent_at >= ${since}::timestamptz`;
  return { delivered: counts?.delivered ?? 0, domain, notDelivered: counts?.not_delivered ?? 0, total: counts?.total ?? 0 };
}

async function eventsFor(logId: number): Promise<EventLine[]> {
  const rows = await client<{ event: string; occurred_at: Date | string; reason: string | null }[]>`
    select event, occurred_at, reason from email_delivery_events where log_id=${logId} order by occurred_at, id`;
  return rows.map((event) => ({ at: toDate(event.occurred_at), event: event.event, reason: event.reason }));
}

async function memberByEmail(email: string): Promise<MemberRef | null> {
  const [row] = await client<{ account_state: string; first_name: string | null; id: number; last_name: string | null; profile_id: number | null }[]>`
    select u.id, u.account_state, p.id as profile_id, p.first_name, p.last_name from users u left join profiles p on p.user_id=u.id where u.email=${email} limit 1`;
  return row ? { accountState: row.account_state, name: fullName(row.first_name, row.last_name), profileId: row.profile_id, userId: row.id } : null;
}

/** How many more alerts of one family this hour's cap allows (the families have independent caps). */
async function remainingHourlyBudget(now: Date, family: 'delivery' | 'repeat'): Promise<number> {
  const [row] = await client<{ recent: number }[]>`
    select count(*)::int recent from operational_alert_outbox
    where kind in ('email_delivery_problem', 'repeated_code_requests')
      and dedupe_key like ${family === 'delivery' ? 'email-delivery-problem:%' : 'repeated-code-requests:%'}
      and created_at >= ${new Date(now.getTime() - 3_600_000).toISOString()}::timestamptz`;
  return Math.max(0, (family === 'delivery' ? HOURLY_ALERT_CAP : HOURLY_REPEAT_ALERT_CAP) - (row?.recent ?? 0));
}

async function reportDeliveryProblems(now: Date, adminEmail: string | null) {
  const summary = { alerted: 0, held: 0, reconciled: 0 };
  const since = new Date(now.getTime() - WATCH_LOOKBACK_MS).toISOString();
  const authCut = new Date(now.getTime() - AUTH_CODE_DEADLINE_MS).toISOString();
  const generalCut = new Date(now.getTime() - GENERAL_DEADLINE_MS).toISOString();
  const finalCut = new Date(now.getTime() - FINAL_DEADLINE_MS).toISOString();
  // Only emails that still owe an alert are selected (the alert for their current tier is not queued yet), so rows already reported
  // can never crowd newer ones out of the batch, however many there are.
  const rows = await client<LogRow[]>`
    select l.id, l.provider_message_id, l.recipient_email, l.recipient_domain, l.user_id, l.kind, l.subject, l.message_ref, l.sent_at, l.status, l.status_at, l.delivered_at,
      u.account_state, p.id as profile_id, p.first_name, p.last_name
    from email_delivery_log l left join users u on u.id=l.user_id left join profiles p on p.user_id=l.user_id
    where l.sent_at >= ${since}::timestamptz and l.status <> 'delivered' and (${adminEmail}::text is null or l.recipient_email <> ${adminEmail})
      and (
        (l.status in ('hard_bounced','blocked','invalid','error','spam')
          and not exists (select 1 from operational_alert_outbox o where o.dedupe_key = 'email-delivery-problem:' || l.id || ':failed'))
        or (l.status not in ('hard_bounced','blocked','invalid','error','spam') and l.sent_at <= ${finalCut}::timestamptz
          and not exists (select 1 from operational_alert_outbox o where o.dedupe_key = 'email-delivery-problem:' || l.id || ':final'))
        or (l.status not in ('hard_bounced','blocked','invalid','error','spam') and l.sent_at > ${finalCut}::timestamptz
          and l.sent_at <= (case when l.kind like 'auth.otp.%' then ${authCut}::timestamptz else ${generalCut}::timestamptz end)
          and not exists (select 1 from operational_alert_outbox o where o.dedupe_key = 'email-delivery-problem:' || l.id || ':late'))
      )
    order by l.sent_at limit 200`;
  const baseUrl = baseUrlForServer();
  for (const [index, row] of rows.entries()) {
    if (summary.alerted >= MAX_ALERTS_PER_RUN) break; // the per-run limit just leaves the rest for the next run
    // The hour's allowance is re-read before every alert, not once per run: an overlapping invocation of the cron may have spent it since.
    if (await remainingHourlyBudget(now, 'delivery') <= 0) { summary.held = rows.length - index; break; } // only the hourly cap earns a summary
    const sentAt = toDate(row.sent_at);
    let tier = alertTier({ kind: row.kind, now, sentAt, status: row.status });
    if (!tier || await alreadyQueued(`email-delivery-problem:${row.id}:${tier}`)) continue;

    let status = row.status;
    let statusAt = toDate(row.status_at);
    let brevoCheck: BrevoCheck = 'skipped';
    if (tier !== 'failed') {
      brevoCheck = await reconcileWithBrevo(row, now);
      const [fresh] = await client<{ status: string; status_at: Date | string }[]>`select status, status_at from email_delivery_log where id=${row.id}`;
      if (fresh) { status = fresh.status; statusAt = toDate(fresh.status_at); }
      if (status === 'delivered') { summary.reconciled += 1; continue; }
      tier = alertTier({ kind: row.kind, now, sentAt, status }) ?? tier;
      if (await alreadyQueued(`email-delivery-problem:${row.id}:${tier}`)) continue;
    }

    const [events, domain, recentRows, codeRows] = await Promise.all([
      eventsFor(row.id),
      domainContext(row.recipient_domain, now),
      client<{ kind: string | null; sent_at: Date | string; status: string; subject: string | null }[]>`
        select kind, subject, sent_at, status from email_delivery_log where recipient_email=${row.recipient_email} and id<>${row.id}
          and sent_at >= ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz order by sent_at desc limit 10`,
      row.kind?.startsWith('auth.otp.')
        ? client<{ requested: number; with_attempt: number }[]>`
            select count(*)::int requested, (count(*) filter (where attempt_count > 0))::int with_attempt from email_otp_codes
            where email=${row.recipient_email} and created_at >= ${new Date(now.getTime() - 3_600_000).toISOString()}::timestamptz`
        : Promise.resolve([]),
    ]);
    const recent: RecentEmail[] = recentRows.map((email) => ({ kind: email.kind, sentAt: toDate(email.sent_at), status: email.status, subject: email.subject }));
    const alert = buildDeliveryProblemAlert({
      baseUrl, brevoCheck,
      codeRequests: codeRows[0] ? { requested: codeRows[0].requested, withEntryAttempt: codeRows[0].with_attempt } : null,
      domain,
      email: { id: row.id, kind: row.kind, messageId: row.provider_message_id, messageRef: row.message_ref, sentAt, status, statusAt, subject: row.subject, to: row.recipient_email },
      events,
      member: row.user_id ? { accountState: row.account_state, name: fullName(row.first_name, row.last_name), profileId: row.profile_id, userId: row.user_id } : null,
      now, recent, tier,
    });
    if (await enqueueOperationalAlert({ bodyHtml: alert.html, dedupeKey: alert.dedupeKey, kind: 'email_delivery_problem', subject: taggedSubject('email.delivery_problem', alert.subject) })) summary.alerted += 1;
  }
  return summary;
}

async function reportRepeatedCodeRequests(now: Date, adminEmail: string | null) {
  let alerted = 0;
  let held = 0;
  const windowStart = new Date(now.getTime() - REPEAT_REQUEST_WINDOW_MS);
  const hourIso = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
  // Groups already reported this hour are excluded in the query (the key is the same SHA-256 the alert builder derives) so they can never
  // crowd a newer one out of the batch; the rest are ordered newest first so the order is deterministic.
  const groups = await client<{ email: string; purpose: string }[]>`
    select c.email, c.purpose from email_otp_codes c where c.created_at >= ${windowStart.toISOString()}::timestamptz
    group by c.email, c.purpose
    having count(*) >= ${REPEAT_REQUEST_THRESHOLD} and max(c.attempt_count) = 0
      and not exists (select 1 from operational_alert_outbox o
        where o.dedupe_key = 'repeated-code-requests:' || encode(sha256(convert_to(c.email || ':' || c.purpose || ':' || ${hourIso}::text, 'UTF8')), 'hex'))
    order by max(c.created_at) desc limit 25`;
  const baseUrl = baseUrlForServer();
  for (const [index, group] of groups.entries()) {
    // Re-read per group, for the same reason as the delivery pass.
    if (await remainingHourlyBudget(now, 'repeat') <= 0) { held = groups.length - index; break; }
    if (adminEmail && group.email === adminEmail) continue;
    const codes = await client<{ created_at: Date | string }[]>`
      select created_at from email_otp_codes where email=${group.email} and purpose=${group.purpose} and created_at >= ${windowStart.toISOString()}::timestamptz order by created_at`;
    const logs = await client<{ id: number; sent_at: Date | string; status: string }[]>`
      select id, sent_at, status from email_delivery_log where recipient_email=${group.email} and kind=${`auth.otp.${group.purpose}`}
        and sent_at >= ${new Date(windowStart.getTime() - 60_000).toISOString()}::timestamptz order by sent_at`;
    const requests = await Promise.all(codes.map(async (code) => {
      const requestedAt = toDate(code.created_at);
      const log = logs.find((entry) => Math.abs(toDate(entry.sent_at).getTime() - requestedAt.getTime()) <= 60_000);
      return { events: log ? await eventsFor(log.id) : [], requestedAt, status: log?.status ?? null };
    }));
    const domain = await domainContext(group.email.slice(group.email.lastIndexOf('@') + 1), now);
    const alert = buildRepeatRequestAlert({ baseUrl, domain, member: await memberByEmail(group.email), now, purpose: group.purpose, requests, to: group.email });
    if (await enqueueOperationalAlert({ bodyHtml: alert.html, dedupeKey: alert.dedupeKey, kind: 'repeated_code_requests', subject: taggedSubject('email.repeated_code_requests', alert.subject) })) alerted += 1;
  }
  return { alerted, held };
}

/** One pass of the watch. Safe to run repeatedly and concurrently: every alert is keyed, so the same email or request burst is reported once. */
export async function runEmailDeliveryWatch(now: Date = new Date()) {
  const adminEmail = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL?.trim().toLowerCase() || null;
  const delivery = await reportDeliveryProblems(now, adminEmail);
  const repeated = await reportRepeatedCodeRequests(now, adminEmail);
  // Past a cap, one summary per family and hour replaces the individual alerts, so the administrator still hears that more exist.
  for (const [kind, held] of [['emails', delivery.held], ['requests', repeated.held]] as const) {
    if (held <= 0) continue;
    const flood = buildFloodSummaryAlert({ baseUrl: baseUrlForServer(), held, kind, now });
    await enqueueOperationalAlert({ bodyHtml: flood.html, dedupeKey: flood.dedupeKey, kind: 'email_delivery_problem', subject: taggedSubject('email.delivery_problem', flood.subject) });
  }
  return { alerted: delivery.alerted, held: delivery.held + repeated.held, reconciled: delivery.reconciled, repeatAlerted: repeated.alerted };
}
