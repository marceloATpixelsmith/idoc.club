import 'server-only';

import { client } from '@/lib/db/drizzle';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { EMAIL_KIND_LABELS } from '@/lib/notifications/communications-report';
import { USER_ACTIVITY_EVENTS, type UserActivityEvent } from '@/lib/activity/user-activity-events';
import { brevoApiKeyForServer } from '@/lib/runtime/configuration';
import { tracedFetch } from '@/lib/observability/outbound-fetch';
import { auditActor, auditTitle, brevoEntry, sortTimeline, timelineRange, withinRange, type BrevoTimelineEvent, type TimelineEntry } from './member-timeline-core';

const ROW_LIMIT = 500;
const BREVO_PAGE_SIZE = 500;
const BREVO_MAX_PAGES = 4;
const OUTCOME_LABELS: Record<string, string> = {
  already_used: 'link already used', breached_password: 'password rejected as breached', expired: 'link expired', rejected: 'rejected', success: 'succeeded', valid: 'link still valid',
};
const SESSION_REVOKE_LABELS: Record<string, string> = { logout: 'signed out', user_logout: 'signed out' };

type Row = Record<string, unknown>;
const iso = (value: unknown): string => new Date(value as string | Date).toISOString();
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const euro = (cents: unknown, currency: unknown) => new Intl.NumberFormat('en', { currency: typeof currency === 'string' ? currency : 'EUR', style: 'currency' }).format(Number(cents) / 100);

export type MemberTimeline = {
  entries: TimelineEntry[];
  from: string;
  member: { email: string; name: string; profileId: number; userId: number };
  providerAvailable: boolean;
  to: string;
  truncated: boolean;
};

async function brevoEvents(email: string, fromKey: string, toKey: string): Promise<BrevoTimelineEvent[] | null> {
  let apiKey: string;
  try { apiKey = brevoApiKeyForServer(); } catch { return null; }
  try {
    const events: BrevoTimelineEvent[] = [];
    for (let page = 0; page < BREVO_MAX_PAGES; page += 1) {
      const url = `https://api.brevo.com/v3/smtp/statistics/events?email=${encodeURIComponent(email)}&startDate=${fromKey}&endDate=${toKey}&limit=${BREVO_PAGE_SIZE}&offset=${page * BREVO_PAGE_SIZE}&sort=asc`;
      const response = await tracedFetch('brevo', url, { headers: { accept: 'application/json', 'api-key': apiKey }, method: 'GET', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return null;
      const body = await response.json() as { events?: { date?: string; event?: string; link?: string; reason?: string; subject?: string }[] };
      const batch = body.events ?? [];
      for (const item of batch) {
        const at = item.date ? new Date(item.date) : null;
        if (item.event && at && !Number.isNaN(at.getTime())) events.push({ at: at.toISOString(), event: item.event, link: item.link, reason: item.reason, subject: item.subject });
      }
      if (batch.length < BREVO_PAGE_SIZE) break;
    }
    return events;
  } catch { return null; }
}

/** One member's history from start to finish, drawn from our own records and Brevo's delivery log, each row labelled
 * with who did it. Administrator-only; read-only. */
export async function getMemberTimeline(profileId: number, fromParam?: string | null, toParam?: string | null): Promise<MemberTimeline | null> {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const range = timelineRange(fromParam, toParam);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [member] = await client<Row[]>`select p.id as profile_id, p.user_id, p.first_name, p.last_name, u.email from profiles p join users u on u.id = p.user_id where p.id = ${profileId} limit 1`;
  if (!member) return null;
  const userId = member.user_id as number;
  const email = member.email as string;
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || email;
  const entries: TimelineEntry[] = [];
  const add = (entry: Omit<TimelineEntry, 'source'> & { source?: TimelineEntry['source'] }) => entries.push({ source: 'idoc', ...entry });

  const [audit, notices, deliveries, securityNotices, tokens, otps, sessions, activity, payments, seminars, seminarAudit, messages, consent, brevo] = await Promise.all([
    client<Row[]>`select id, actor_id, action, reason, created_at from audit_log where created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz and ((entity_type = 'user' and entity_id = ${String(userId)}) or (entity_type = 'profile' and entity_id = ${String(profileId)}) or actor_id = ${userId}) order by created_at limit ${ROW_LIMIT}`,
    client<Row[]>`select id, kind, created_at, sent_at, dead_lettered_at, last_error_code, attempt_count from notification_outbox where profile_id = ${profileId} and (created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or sent_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or dead_lettered_at between ${fromIso}::timestamptz and ${toIso}::timestamptz) order by created_at limit ${ROW_LIMIT}`,
    client<Row[]>`select id, purpose, created_at, sent_at, dead_lettered_at, terminal_at, terminal_reason, last_error_code from account_delivery_outbox where user_id = ${userId} and (created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or sent_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or dead_lettered_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or terminal_at between ${fromIso}::timestamptz and ${toIso}::timestamptz) order by created_at limit ${ROW_LIMIT}`,
    client<Row[]>`select id, kind, created_at, sent_at, dead_lettered_at, last_error_code from auth_security_notification_outbox where user_id = ${userId} and (created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or sent_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or dead_lettered_at between ${fromIso}::timestamptz and ${toIso}::timestamptz) order by created_at limit ${ROW_LIMIT}`,
    client<Row[]>`select id, purpose, created_at, expires_at from account_tokens where user_id = ${userId} and created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by created_at limit ${ROW_LIMIT}`,
    client<Row[]>`select id, purpose, created_at, attempt_count from email_otp_codes where user_id = ${userId} and created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by created_at limit ${ROW_LIMIT}`,
    client<Row[]>`select id, authenticated_at, revoked_at, revoke_reason, device_label from auth_sessions where user_id = ${userId} and (authenticated_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or revoked_at between ${fromIso}::timestamptz and ${toIso}::timestamptz) order by authenticated_at limit ${ROW_LIMIT}`,
    client<Row[]>`select id, event, outcome, detail, occurred_at from user_activity_events where user_id = ${userId} and occurred_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by occurred_at limit ${ROW_LIMIT}`,
    client<Row[]>`select id, source, amount_cents, currency, paid_at, administrator_id from payments where profile_id = ${profileId} and paid_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by paid_at limit ${ROW_LIMIT}`,
    client<Row[]>`select r.id, s.title, r.registered_at, r.canceled_at from seminar_registrations r join seminars s on s.id = r.seminar_id where r.profile_id = ${profileId} and (r.registered_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or r.canceled_at between ${fromIso}::timestamptz and ${toIso}::timestamptz) order by r.registered_at limit ${ROW_LIMIT}`,
    client<Row[]>`select a.id, a.actor_id, a.action, a.reason, a.created_at, a.entity_id, s.title from audit_log a join seminar_registrations r on a.entity_type = 'seminar_registration' and a.entity_id = r.id::text join seminars s on s.id = r.seminar_id where r.profile_id = ${profileId} and a.created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by a.created_at limit ${ROW_LIMIT}`,
    client<Row[]>`select m.id, c.category, c.subject, m.created_at from support_messages m join support_conversations c on c.id = m.conversation_id where m.author_user_id = ${userId} and m.author_side = 'member' and m.created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by m.created_at limit ${ROW_LIMIT}`,
    client<Row[]>`select terms_accepted_at, privacy_accepted_at from onboarding_consents where profile_id = ${profileId}`,
    brevoEvents(email, range.fromKey, range.toKey),
  ]);

  for (const row of audit) add({ actor: auditActor(row.actor_id as number | null, userId, row.action as string), at: iso(row.created_at), category: 'Account', detail: text(row.reason), id: `audit-${row.id}`, title: auditTitle(row.action as string) });
  for (const row of notices) {
    const label = EMAIL_KIND_LABELS[row.kind as string] ?? (row.kind as string);
    add({ actor: 'server', at: iso(row.created_at), category: 'Email', id: `notice-${row.id}-queued`, title: `${label} queued` });
    if (row.sent_at) add({ actor: 'server', at: iso(row.sent_at), category: 'Email', id: `notice-${row.id}-sent`, title: `${label} sent to Brevo` });
    if (row.dead_lettered_at) add({ actor: 'server', at: iso(row.dead_lettered_at), category: 'Email', detail: text(row.last_error_code), id: `notice-${row.id}-dead`, title: `${label} failed; the server gave up` });
  }
  for (const row of deliveries) {
    const label = EMAIL_KIND_LABELS[`account.${row.purpose}`] ?? `${row.purpose} email`;
    add({ actor: 'server', at: iso(row.created_at), category: 'Email', id: `delivery-${row.id}-queued`, title: `${label} queued` });
    if (row.sent_at) add({ actor: 'server', at: iso(row.sent_at), category: 'Email', id: `delivery-${row.id}-sent`, title: `${label} sent to Brevo` });
    if (row.dead_lettered_at) add({ actor: 'server', at: iso(row.dead_lettered_at), category: 'Email', detail: text(row.last_error_code), id: `delivery-${row.id}-dead`, title: `${label} failed; the server gave up` });
    if (row.terminal_at) add({ actor: 'server', at: iso(row.terminal_at), category: 'Email', detail: text(row.terminal_reason), id: `delivery-${row.id}-terminal`, title: `${label} cancelled before sending` });
  }
  for (const row of securityNotices) {
    const label = `Security notice: ${String(row.kind).replace(/_/g, ' ')}`;
    add({ actor: 'server', at: iso(row.created_at), category: 'Email', id: `security-${row.id}-queued`, title: `${label} queued` });
    if (row.sent_at) add({ actor: 'server', at: iso(row.sent_at), category: 'Email', id: `security-${row.id}-sent`, title: `${label} sent to Brevo` });
    if (row.dead_lettered_at) add({ actor: 'server', at: iso(row.dead_lettered_at), category: 'Email', detail: text(row.last_error_code), id: `security-${row.id}-dead`, title: `${label} failed; the server gave up` });
  }
  for (const row of tokens) add({ actor: 'server', at: iso(row.created_at), category: 'Sign-in', detail: `Link valid until ${iso(row.expires_at).replace('T', ' ').slice(0, 16)} UTC`, id: `token-${row.id}`, title: row.purpose === 'migration_activation' ? 'Activation link issued' : 'Password-reset link issued' });
  for (const row of otps) add({ actor: 'server', at: iso(row.created_at), category: 'Sign-in', detail: Number(row.attempt_count) > 0 ? `${row.attempt_count} code attempt(s)` : undefined, id: `otp-${row.id}`, title: `Verification code emailed (${String(row.purpose).replace(/_/g, ' ')})` });
  for (const row of sessions) {
    add({ actor: 'user', at: iso(row.authenticated_at), category: 'Sign-in', detail: text(row.device_label), id: `session-${row.id}-in`, title: 'Signed in' });
    if (row.revoked_at) add({ actor: 'server', at: iso(row.revoked_at), category: 'Sign-in', detail: text(row.device_label), id: `session-${row.id}-out`, title: `Session ended (${SESSION_REVOKE_LABELS[String(row.revoke_reason)] ?? String(row.revoke_reason ?? 'ended').replace(/_/g, ' ')})` });
  }
  for (const row of activity) {
    const detail = (row.detail ?? {}) as Record<string, unknown>;
    const parts = [row.outcome ? OUTCOME_LABELS[String(row.outcome)] ?? String(row.outcome).replace(/_/g, ' ') : null,
      detail.kind ? `notice: ${EMAIL_KIND_LABELS[String(detail.kind)] ?? detail.kind}` : null,
      detail.signedIn === false ? 'not signed in' : detail.signedIn === true ? 'already signed in' : null,
      detail.browser === 'scanner' ? 'looks like an automated link checker' : null,
      detail.host ? `reached ${detail.host}` : null,
      detail.reason ? String(detail.reason).replace(/_/g, ' ') : null].filter(Boolean);
    add({ actor: 'user', at: iso(row.occurred_at), category: String(row.event).startsWith('sign_in') ? 'Sign-in' : 'Email', detail: parts.join(' · ') || undefined, id: `activity-${row.id}`, title: USER_ACTIVITY_EVENTS[row.event as UserActivityEvent] ?? String(row.event) });
  }
  for (const row of payments) {
    const stripe = String(row.source).startsWith('stripe_') && row.source !== 'stripe_manual';
    add({ actor: stripe ? 'server' : 'administrator', at: iso(row.paid_at), category: 'Billing', detail: String(row.source).replace(/_/g, ' '), id: `payment-${row.id}`, title: `Payment of ${euro(row.amount_cents, row.currency)} recorded` });
  }
  // Registration actions come from the audit trail, which says whether the member or an administrator did it. A registration with no
  // audit row for its creation or cancellation (older records) falls back to the registration's own timestamps, attributed to the member.
  const audited = new Set(seminarAudit.map((row) => `${row.entity_id}:${row.action}`));
  for (const row of seminarAudit) add({ actor: auditActor(row.actor_id as number | null, userId, row.action as string), at: iso(row.created_at), category: 'Seminar', detail: [row.title, text(row.reason)].filter(Boolean).join(' · ') || undefined, id: `seminar-audit-${row.id}`, title: auditTitle(row.action as string) });
  for (const row of seminars) {
    const hasCreateAudit = ['member.seminar_registration.registered', 'admin.seminar_registration.created'].some((action) => audited.has(`${row.id}:${action}`));
    const hasCancelAudit = ['member.seminar_registration.canceled', 'admin.seminar_registration.status_changed'].some((action) => audited.has(`${row.id}:${action}`));
    if (row.registered_at && !hasCreateAudit) add({ actor: 'user', at: iso(row.registered_at), category: 'Seminar', detail: String(row.title), id: `seminar-${row.id}-reg`, title: 'Registered for a seminar' });
    if (row.canceled_at && !hasCancelAudit) add({ actor: 'user', at: iso(row.canceled_at), category: 'Seminar', detail: String(row.title), id: `seminar-${row.id}-cancel`, title: 'Seminar registration canceled' });
  }
  for (const row of messages) add({ actor: 'user', at: iso(row.created_at), category: 'Support', detail: String(row.subject), id: `support-${row.id}`, title: 'Sent a support message' });
  for (const row of consent) {
    for (const [key, label] of [['terms_accepted_at', 'Accepted the terms'], ['privacy_accepted_at', 'Accepted the privacy policy']] as const) {
      const at = row[key] ? iso(row[key]) : null;
      if (at && at >= fromIso && at <= toIso) add({ actor: 'user', at, category: 'Account', id: `consent-${key}`, title: label });
    }
  }
  (brevo ?? []).forEach((event, index) => entries.push(brevoEntry(event, index)));

  const sorted = sortTimeline(withinRange(entries, fromIso, toIso), 'asc');
  const truncated = [audit, notices, deliveries, securityNotices, tokens, otps, sessions, activity, payments, seminars, seminarAudit, messages].some((rows) => rows.length >= ROW_LIMIT);
  return { entries: sorted, from: range.fromKey, member: { email, name, profileId, userId }, providerAvailable: brevo !== null, to: range.toKey, truncated };
}
