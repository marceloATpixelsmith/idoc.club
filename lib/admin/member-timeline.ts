import 'server-only';

import { client } from '@/lib/db/drizzle';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { EMAIL_KIND_LABELS } from '@/lib/notifications/communications-report';
import { USER_ACTIVITY_EVENTS, type UserActivityEvent } from '@/lib/activity/user-activity-events';
import { brevoApiKeyForServer } from '@/lib/runtime/configuration';
import { tracedFetch } from '@/lib/observability/outbound-fetch';
import { ACCOUNT_STATE_LABELS, accountMilestones, administratorSegments, auditActor, auditDuplicatesAnotherSource, auditTitle, brevoEntry, brevoWindowStart, emailStepTitles, errorCodeLabel, otpPurposeLabel, securityNoticeLabel, sortTimeline, timelineRange, withinRange, type BrevoTimelineEvent, type TimelineEntry } from './member-timeline-core';

const ROW_LIMIT = 500;
const BREVO_PAGE_SIZE = 500;
const BREVO_MAX_PAGES = 4;
const OUTCOME_LABELS: Record<string, string> = {
  already_used: 'the link had already been used', breached_password: 'the password was rejected because it appears in a data breach', expired: 'the link had expired', rejected: 'it was rejected', success: 'it worked', valid: 'the link was still valid',
};
const SIGN_IN_REFUSAL_LABELS: Record<string, string> = { account_not_eligible: 'the account is not allowed to sign in right now', wrong_password: 'wrong password' };
const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  bank_transfer: 'bank transfer', cash: 'cash', complimentary: 'complimentary (free) grant', legacy_import: 'imported from the old site',
  stripe_manual: 'Stripe, entered by an administrator', stripe_one_time: 'Stripe, one-time payment', stripe_recurring: 'Stripe, recurring subscription',
};
type Row = Record<string, unknown>;
const iso = (value: unknown): string => new Date(value as string | Date).toISOString();
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const euro = (cents: unknown, currency: unknown) => new Intl.NumberFormat('en', { currency: typeof currency === 'string' ? currency : 'EUR', style: 'currency' }).format(Number(cents) / 100);

export type MemberTimeline = {
  accountStatus: string;
  entries: TimelineEntry[];
  from: string;
  member: { email: string; name: string; profileId: number; userId: number };
  milestones: TimelineEntry[];
  providerAvailable: boolean;
  /** Sources that could not be read (for example a table not yet created in this environment); the rest of the timeline is still shown. */
  unavailableSources: string[];
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
export async function getMemberTimeline(profileId: number, fromParam?: string | null, toParam?: string | null, allDates = false): Promise<MemberTimeline | null> {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const range = timelineRange(fromParam, toParam, new Date(), allDates);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [member] = await client<Row[]>`select p.id as profile_id, p.user_id, p.first_name, p.last_name, p.created_at as profile_created, p.legacy_wp_user_id, u.email, u.created_at as user_created, u.email_verified_at, u.account_state from profiles p join users u on u.id = p.user_id where p.id = ${profileId} limit 1`;
  if (!member) return null;
  const userId = member.user_id as number;
  const email = member.email as string;
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || email;
  const unavailableSources: string[] = [];
  // One unreadable source (a table not created yet in this environment, a slow query) must not blank the whole timeline.
  const safe = async <T,>(name: string, run: Promise<T>, fallback: T): Promise<T> => {
    try { return await run; } catch { unavailableSources.push(name); return fallback; }
  };
  const entries: TimelineEntry[] = [];
  const add = (entry: Omit<TimelineEntry, 'source'> & { source?: TimelineEntry['source'] }) => entries.push({ source: 'idoc', ...entry });

  const [audit, devices, notices, deliveries, securityNotices, tokens, otps, activity, payments, seminars, seminarAudit, messages, consent, brevo] = await Promise.all([
    safe('Audit trail', client<Row[]>`select id, actor_id, action, reason, created_at, after_json #>> '{payment,id}' as payment_id, coalesce(after_json ->> 'role', before_json ->> 'role') as role_name from audit_log where created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz and ((entity_type = 'user' and entity_id = ${String(userId)}) or (entity_type = 'profile' and entity_id = ${String(profileId)}) or actor_id = ${userId}) order by created_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Devices', client<Row[]>`select authenticated_at, device_label from auth_sessions where user_id = ${userId} and authenticated_at between ${fromIso}::timestamptz and ${toIso}::timestamptz and device_label is not null order by authenticated_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Email queue', client<Row[]>`select id, kind, created_at, sent_at, dead_lettered_at, last_error_code, attempt_count from notification_outbox where profile_id = ${profileId} and (created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or sent_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or dead_lettered_at between ${fromIso}::timestamptz and ${toIso}::timestamptz) order by created_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Account emails', client<Row[]>`select id, purpose, created_at, sent_at, dead_lettered_at, terminal_at, terminal_reason, last_error_code from account_delivery_outbox where user_id = ${userId} and (created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or sent_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or dead_lettered_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or terminal_at between ${fromIso}::timestamptz and ${toIso}::timestamptz) order by created_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Security notices', client<Row[]>`select id, kind, created_at, sent_at, dead_lettered_at, last_error_code from auth_security_notification_outbox where user_id = ${userId} and (created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or sent_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or dead_lettered_at between ${fromIso}::timestamptz and ${toIso}::timestamptz) order by created_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Sign-in links', client<Row[]>`select id, purpose, created_at, expires_at from account_tokens where user_id = ${userId} and created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by created_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Verification codes', client<Row[]>`select id, purpose, created_at, attempt_count from email_otp_codes where user_id = ${userId} and created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by created_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Member activity log', client<Row[]>`select id, event, outcome, detail, occurred_at from user_activity_events where user_id = ${userId} and occurred_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by occurred_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Payments', client<Row[]>`select id, source, amount_cents, currency, paid_at, administrator_id, reason from payments where profile_id = ${profileId} and paid_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by paid_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Seminar registrations', client<Row[]>`select r.id, s.title, r.registered_at, r.canceled_at from seminar_registrations r join seminars s on s.id = r.seminar_id where r.profile_id = ${profileId} and (r.registered_at between ${fromIso}::timestamptz and ${toIso}::timestamptz or r.canceled_at between ${fromIso}::timestamptz and ${toIso}::timestamptz) order by r.registered_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Seminar changes', client<Row[]>`select a.id, a.actor_id, a.action, a.reason, a.created_at, a.entity_id, s.title from audit_log a join seminar_registrations r on a.entity_type = 'seminar_registration' and a.entity_id = r.id::text join seminars s on s.id = r.seminar_id where r.profile_id = ${profileId} and a.created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by a.created_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Support messages', client<Row[]>`select m.id, c.category, c.subject, m.created_at from support_messages m join support_conversations c on c.id = m.conversation_id where m.author_user_id = ${userId} and m.author_side = 'member' and m.created_at between ${fromIso}::timestamptz and ${toIso}::timestamptz order by m.created_at limit ${ROW_LIMIT}`, [] as Row[]),
    safe('Consent', client<Row[]>`select terms_accepted_at, privacy_accepted_at from onboarding_consents where profile_id = ${profileId}`, [] as Row[]),
    (() => { const start = brevoWindowStart(range.fromKey, range.toKey); return start ? brevoEvents(email, start, range.toKey) : Promise.resolve([] as BrevoTimelineEvent[]); })(),
  ]);

  const loaded = { accountEmails: !unavailableSources.includes('Account emails'), paymentIds: unavailableSources.includes('Payments') ? null : new Set(payments.map((payment) => String(payment.id))) };
  // A sign-in's browser and device come from the session record created at the same moment (within a few seconds).
  const deviceAt = (at: string) => devices.find((device) => Math.abs(Date.parse(iso(device.authenticated_at)) - Date.parse(at)) < 5000)?.device_label as string | undefined;
  // Administrator rows name the administrator, so look their names up once (a failed lookup just falls back to "An administrator").
  const adminIds = [...new Set([...audit, ...seminarAudit].filter((row) => auditActor(row.actor_id as number | null, userId, row.action as string) === 'administrator' && typeof row.actor_id === 'number').map((row) => row.actor_id as number))];
  const adminNames = new Map<number, string>();
  if (adminIds.length > 0) {
    try {
      const people = await client<Row[]>`select u.id, u.email, p.first_name, p.last_name from users u left join profiles p on p.user_id = u.id where u.id = any(${adminIds})`;
      for (const person of people) adminNames.set(person.id as number, [person.first_name, person.last_name].filter(Boolean).join(' ') || String(person.email));
    } catch { /* names are a convenience */ }
  }
  const adminLine = (row: Row, withRole: boolean) => {
    const line = administratorSegments({ action: row.action as string, name: adminNames.get(row.actor_id as number), reason: text(row.reason), role: withRole ? text(row.role_name) : undefined });
    return { segments: line.segments, title: line.title };
  };
  for (const row of audit.filter((entry) => !auditDuplicatesAnotherSource(entry.action as string, loaded, entry.payment_id as string | null))) {
    const at = iso(row.created_at);
    const byAdministrator = auditActor(row.actor_id as number | null, userId, row.action as string) === 'administrator';
    add({ actor: auditActor(row.actor_id as number | null, userId, row.action as string), at, category: String(row.action).startsWith('account.session') ? 'Sign-in' : 'Account', detail: byAdministrator ? undefined : [row.action === 'account.session.signed_in' ? deviceAt(at) : undefined, text(row.reason)].filter(Boolean).join(' · ') || undefined, id: `audit-${row.id}`, ...(byAdministrator ? adminLine(row, true) : { title: auditTitle(row.action as string) }) });
  }
  for (const row of notices) {
    const label = EMAIL_KIND_LABELS[row.kind as string] ?? (row.kind as string);
    const step = emailStepTitles(label);
    if (!row.sent_at && !row.dead_lettered_at) add({ actor: 'server', at: iso(row.created_at), category: 'Email', id: `notice-${row.id}-queued`, title: step.queued });
    if (row.sent_at) add({ actor: 'server', at: iso(row.sent_at), category: 'Email', id: `notice-${row.id}-sent`, title: step.sent });
    if (row.dead_lettered_at) add({ actor: 'server', at: iso(row.dead_lettered_at), category: 'Email', detail: errorCodeLabel(text(row.last_error_code)), id: `notice-${row.id}-dead`, title: step.failed });
  }
  for (const row of deliveries) {
    const label = EMAIL_KIND_LABELS[`account.${row.purpose}`] ?? `${row.purpose} email`;
    const step = emailStepTitles(label);
    if (!row.sent_at && !row.dead_lettered_at && !row.terminal_at) add({ actor: 'server', at: iso(row.created_at), category: 'Email', id: `delivery-${row.id}-queued`, title: step.queued });
    if (row.sent_at) add({ actor: 'server', at: iso(row.sent_at), category: 'Email', id: `delivery-${row.id}-sent`, title: step.sent });
    if (row.dead_lettered_at) add({ actor: 'server', at: iso(row.dead_lettered_at), category: 'Email', detail: errorCodeLabel(text(row.last_error_code)), id: `delivery-${row.id}-dead`, title: step.failed });
    if (row.terminal_at) add({ actor: 'server', at: iso(row.terminal_at), category: 'Email', detail: errorCodeLabel(text(row.terminal_reason)), id: `delivery-${row.id}-terminal`, title: step.cancelled });
  }
  for (const row of securityNotices) {
    const step = emailStepTitles(securityNoticeLabel(String(row.kind)));
    if (!row.sent_at && !row.dead_lettered_at) add({ actor: 'server', at: iso(row.created_at), category: 'Email', id: `security-${row.id}-queued`, title: step.queued });
    if (row.sent_at) add({ actor: 'server', at: iso(row.sent_at), category: 'Email', id: `security-${row.id}-sent`, title: step.sent });
    if (row.dead_lettered_at) add({ actor: 'server', at: iso(row.dead_lettered_at), category: 'Email', detail: errorCodeLabel(text(row.last_error_code)), id: `security-${row.id}-dead`, title: step.failed });
  }
  for (const row of tokens) add({ actor: 'server', at: iso(row.created_at), category: 'Sign-in', detail: `The link in the email works until ${iso(row.expires_at).replace('T', ' ').slice(0, 16)} UTC`, id: `token-${row.id}`, title: row.purpose === 'migration_activation' ? 'Created an activation link for them' : 'Created a password-reset link for them' });
  for (const row of otps) add({ actor: 'server', at: iso(row.created_at), category: 'Sign-in', detail: Number(row.attempt_count) > 0 ? `They typed a code ${row.attempt_count} time${Number(row.attempt_count) === 1 ? '' : 's'}` : undefined, id: `otp-${row.id}`, title: `Emailed them a ${otpPurposeLabel(String(row.purpose))}` });
  for (const row of activity) {
    const detail = (row.detail ?? {}) as Record<string, unknown>;
    const parts = [row.outcome ? OUTCOME_LABELS[String(row.outcome)] ?? String(row.outcome).replace(/_/g, ' ') : null,
      detail.kind ? `from the email: ${EMAIL_KIND_LABELS[String(detail.kind)] ?? String(detail.kind).replace(/[._]/g, ' ')}` : null,
      detail.signedIn === false ? 'they were not signed in' : detail.signedIn === true ? 'they were already signed in' : null,
      detail.browser === 'scanner' ? 'looks like an automated link checker, not a person' : null,
      detail.host ? `on ${detail.host}` : null,
      detail.reason ? SIGN_IN_REFUSAL_LABELS[String(detail.reason)] ?? String(detail.reason).replace(/_/g, ' ') : null].filter(Boolean);
    const sentence = parts.join(' · ');
    add({ actor: 'user', at: iso(row.occurred_at), category: String(row.event).startsWith('sign_in') ? 'Sign-in' : 'Email', detail: sentence ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : undefined, id: `activity-${row.id}`, title: USER_ACTIVITY_EVENTS[row.event as UserActivityEvent] ?? String(row.event) });
  }
  for (const row of payments) {
    const stripe = String(row.source).startsWith('stripe_') && row.source !== 'stripe_manual';
    const how = PAYMENT_SOURCE_LABELS[String(row.source)] ?? String(row.source).replace(/_/g, ' ');
    add({ actor: stripe ? 'server' : 'administrator', at: iso(row.paid_at), category: 'Billing', detail: [`Paid by ${how}`, text(row.reason) ? `Note: ${text(row.reason)}` : null].filter(Boolean).join(' · '), id: `payment-${row.id}`, title: stripe ? `A payment of ${euro(row.amount_cents, row.currency)} was received and recorded` : `An administrator recorded a payment of ${euro(row.amount_cents, row.currency)}` });
  }
  // Registration actions come from the audit trail, which says whether the member or an administrator did it. A registration with no
  // audit row for its creation or cancellation (older records) falls back to the registration's own timestamps, attributed to the member.
  const audited = new Set(seminarAudit.map((row) => `${row.entity_id}:${row.action}`));
  for (const row of seminarAudit) {
    const byAdministrator = auditActor(row.actor_id as number | null, userId, row.action as string) === 'administrator';
    add({ actor: auditActor(row.actor_id as number | null, userId, row.action as string), at: iso(row.created_at), category: 'Seminar', detail: byAdministrator ? text(row.title) : [row.title, text(row.reason)].filter(Boolean).join(' · ') || undefined, id: `seminar-audit-${row.id}`, ...(byAdministrator ? adminLine(row, false) : { title: auditTitle(row.action as string) }) });
  }
  for (const row of seminars) {
    const hasCreateAudit = ['member.seminar_registration.registered', 'admin.seminar_registration.created'].some((action) => audited.has(`${row.id}:${action}`));
    const hasCancelAudit = ['member.seminar_registration.canceled', 'admin.seminar_registration.status_changed'].some((action) => audited.has(`${row.id}:${action}`));
    if (row.registered_at && !hasCreateAudit) add({ actor: 'user', at: iso(row.registered_at), category: 'Seminar', detail: String(row.title), id: `seminar-${row.id}-reg`, title: 'Registered for a seminar' });
    if (row.canceled_at && !hasCancelAudit) add({ actor: 'user', at: iso(row.canceled_at), category: 'Seminar', detail: String(row.title), id: `seminar-${row.id}-cancel`, title: 'Canceled their seminar registration' });
  }
  for (const row of messages) add({ actor: 'user', at: iso(row.created_at), category: 'Support', detail: String(row.subject), id: `support-${row.id}`, title: 'Sent a message in a support conversation' });
  for (const row of consent) {
    for (const [key, label] of [['terms_accepted_at', 'Accepted the terms'], ['privacy_accepted_at', 'Accepted the privacy policy']] as const) {
      const at = row[key] ? iso(row[key]) : null;
      if (at && at >= fromIso && at <= toIso) add({ actor: 'user', at, category: 'Account', id: `consent-${key}`, title: label });
    }
  }
  (brevo ?? []).forEach((event, index) => entries.push(brevoEntry(event, index)));

  const milestones = accountMilestones({ accountState: String(member.account_state), emailVerifiedAt: member.email_verified_at ? iso(member.email_verified_at) : null, legacyWpUserId: (member.legacy_wp_user_id as number | null) ?? null, profileCreatedAt: iso(member.profile_created), userCreatedAt: iso(member.user_created) });
  entries.push(...milestones);
  const sorted = sortTimeline(withinRange(entries, fromIso, toIso), 'asc');
  const truncated = [audit, notices, deliveries, securityNotices, tokens, otps, activity, payments, seminars, seminarAudit, messages].some((rows) => rows.length >= ROW_LIMIT);
  return { accountStatus: ACCOUNT_STATE_LABELS[String(member.account_state)] ?? String(member.account_state), entries: sorted, from: range.fromKey, member: { email, name, profileId, userId }, milestones, providerAvailable: brevo !== null, to: range.toKey, truncated, unavailableSources: [...new Set(unavailableSources)] };
}
