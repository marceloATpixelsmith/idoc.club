// Pure rules and wording for the email delivery watch (docs/05, docs/07): which emails are overdue, what to tell the administrator about
// each, and the alert emails themselves. No IO here so every decision and every sentence can be unit tested.
import { createHash } from 'node:crypto';
import { escapeHtml, IDOC_EMAIL_COLORS, renderTransactionalEmail } from './email-template.ts';

/** A sign-in, sign-up or reset code is only useful for minutes, so a code email not reported delivered after 5 minutes is already a
 * problem for the member waiting on it. Everything else is given 30 minutes, and anything still undelivered after 24 hours is
 * reported once more as final (Brevo retries a deferred message for a day or two, not indefinitely). */
export const AUTH_CODE_DEADLINE_MS = 5 * 60_000;
export const GENERAL_DEADLINE_MS = 30 * 60_000;
export const FINAL_DEADLINE_MS = 24 * 3_600_000;
/** The watch never reaches further back than this, so switching it on cannot flood the administrator with history. */
export const WATCH_LOOKBACK_MS = 48 * 3_600_000;
/** Three codes requested for one address within 15 minutes, none of them ever entered. */
export const REPEAT_REQUEST_THRESHOLD = 3;
export const REPEAT_REQUEST_WINDOW_MS = 15 * 60_000;

/** At most this many alerts per hour. Past it the watch holds the rest and sends one summary instead, so a burst of undeliverable
 * addresses (a provider outage, or someone submitting many bad addresses) cannot flood the administrator's mailbox. */
export const HOURLY_ALERT_CAP = 30;
export const MAX_ALERTS_PER_RUN = 25;

export type AlertTier = 'failed' | 'final' | 'late';
const FAILED_STATUSES = ['hard_bounced', 'blocked', 'invalid', 'error', 'spam'];

export function isAuthCodeKind(kind: string | null | undefined): boolean {
  return Boolean(kind?.startsWith('auth.otp.'));
}

export function deliveryDeadlineMs(kind: string | null | undefined): number {
  return isAuthCodeKind(kind) ? AUTH_CODE_DEADLINE_MS : GENERAL_DEADLINE_MS;
}

/** Whether an email needs an alert now, and which one: `failed` the moment Brevo reports a permanent failure, `late` once it has been
 * undelivered past its deadline, `final` once it has been undelivered for 24 hours. Null when there is nothing to report yet. */
export function alertTier(input: { kind: string | null; now: Date; sentAt: Date; status: string }): AlertTier | null {
  if (input.status === 'delivered') return null;
  if (FAILED_STATUSES.includes(input.status)) return 'failed';
  const age = input.now.getTime() - input.sentAt.getTime();
  if (age >= FINAL_DEADLINE_MS) return 'final';
  return age >= deliveryDeadlineMs(input.kind) ? 'late' : null;
}

const KIND_LABELS: Record<string, string> = {
  'account.migration_activation': 'account activation link (imported member)',
  'account.password_reset': 'password-reset link',
  'auth.otp.google_disconnect_verification': 'code to disconnect Google',
  'auth.otp.login_verification': 'sign-in code',
  'auth.otp.password_reset': 'password-reset code',
  'auth.otp.signup_verification': 'sign-up code',
};
export function emailKindLabel(kind: string | null, subject: string | null): string {
  return (kind && KIND_LABELS[kind]) || subject || 'email';
}

/** Untrusted text (a Brevo reason written by the recipient's mail server, a member's name, a subject line) as it may appear in an alert.
 * HTML-escaped, and with URL schemes removed: the send boundary refuses any message that mentions another IDOC host as a URL, so a URL-like
 * string in a bounce reason could otherwise stop the alert about that very email from ever being delivered. */
const stripSchemes = (value: string) => value.replace(/[a-z][a-z0-9+.-]*:\/\//gi, '');
export const untrusted = (value: string) => escapeHtml(stripSchemes(value));

export const utc = (at: Date) => `${at.toISOString().replace('T', ' ').slice(0, 19)} UTC`;

export type BrevoCheck = 'events_found' | 'no_events' | 'skipped' | 'unavailable';
export type EventLine = { at: Date; event: string; reason: string | null };

/** The plain-English reading of where an email stands, and what to do next. Written for the person who has to troubleshoot it. */
export function diagnose(input: { ageMinutes: number; brevoCheck: BrevoCheck; events: EventLine[]; status: string }): { steps: string[]; summary: string } {
  const lastReason = [...input.events].reverse().find((event) => event.reason)?.reason?.replace(/[a-z][a-z0-9+.-]*:\/\//gi, '');
  const reason = lastReason ? ` Brevo's reason: “${lastReason}”.` : '';
  switch (input.status) {
    case 'hard_bounced':
      return { summary: `Permanent failure: the recipient's mail server says this address does not exist or refuses mail.${reason}`, steps: ['Ask the member for a different address, or check it for a typo.', 'Brevo will not retry a hard bounce and adds the address to its blocklist.'] };
    case 'blocked':
      return { summary: `Brevo refused to send: the address is on Brevo's blocklist (usually after an earlier bounce, complaint or unsubscribe).${reason}`, steps: ['In Brevo open Contacts → Blocked contacts and search the address; remove it only if you are sure it is valid.', 'Then ask the member to try again.'] };
    case 'invalid':
      return { summary: `Brevo judged the address invalid and did not attempt delivery.${reason}`, steps: ['Check the address for a typo and ask the member for a corrected one.'] };
    case 'spam':
      return { summary: 'The recipient marked this email as spam. Delivery succeeded, but repeated complaints damage the sending domain\'s reputation for every member.', steps: ['Do not email this member again unless they ask.', 'If several members complain, review what is being sent and how often.'] };
    case 'error':
      return { summary: `Brevo reported an internal error for this message.${reason}`, steps: ['Check Brevo\'s status page, then resend (the member can request a new code or link).'] };
    case 'deferred': case 'soft_bounced':
      return { summary: `The recipient's mail server temporarily refused the message and Brevo is retrying (it keeps trying for up to a day or two).${reason} This is typical of greylisting or throttling by large providers, and some providers delay mail from senders they have not seen much.`, steps: ['Wait: most deferred mail is accepted on a later retry.', 'Ask the member to check spam/junk and to request only one code and wait.', 'If several members at the same provider are affected (see the provider line below), the provider is throttling us; consider contacting their postmaster.'] };
    default:
      if (input.brevoCheck === 'no_events') {
        return { summary: `Brevo accepted the message ${input.ageMinutes} minutes ago but has reported no event for it, not even when asked directly. The recipient's mail server has not answered yet.`, steps: ['Search the address in Brevo → Transactional → Logs and look at the message\'s status there.', 'If Brevo shows it as delivered, the Brevo webhook is not reaching IDOC: check the Notify URL and the events ticked in Brevo (docs/07).', 'Ask the member to check spam/junk before requesting another message.'] };
      }
      if (input.brevoCheck === 'unavailable') {
        return { summary: `Brevo accepted the message ${input.ageMinutes} minutes ago and reported nothing, and IDOC could not reach Brevo's log to check.`, steps: ['Search the address in Brevo → Transactional → Logs.', 'Check that BREVO_API_KEY is valid and Brevo is up.'] };
      }
      return { summary: `Brevo accepted the message ${input.ageMinutes} minutes ago but has not reported it delivered.`, steps: ['Search the address in Brevo → Transactional → Logs.'] };
  }
}

export type DomainContext = { delivered: number; domain: string; notDelivered: number; total: number };
export type MemberRef = { accountState: string | null; name: string | null; profileId: number | null; userId: number | null };
export type RecentEmail = { kind: string | null; sentAt: Date; status: string; subject: string | null };

const cell = 'padding:6px 10px;border-bottom:1px solid ' + IDOC_EMAIL_COLORS.border + ';vertical-align:top;font-size:14px;';
const row = (label: string, valueHtml: string) => `<tr><td style="${cell}color:${IDOC_EMAIL_COLORS.muted};white-space:nowrap;">${escapeHtml(label)}</td><td style="${cell}">${valueHtml}</td></tr>`;
const table = (rows: string) => `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">${rows}</table>`;
const h = (text: string) => `<h3 style="margin:22px 0 8px;color:${IDOC_EMAIL_COLORS.gold};font-size:16px;">${escapeHtml(text)}</h3>`;
const code = (value: string) => `<code style="font-family:Consolas,Menlo,monospace;font-size:13px;word-break:break-all;">${escapeHtml(value)}</code>`;

function memberRows(member: MemberRef | null, baseUrl: string): string {
  if (!member?.userId) return row('Member', 'No account (the address is not tied to a member)');
  const link = member.profileId ? ` · <a href="${escapeHtml(`${baseUrl}/admin/members?timeline=${member.profileId}`)}" style="color:${IDOC_EMAIL_COLORS.gold};">open their timeline</a>` : '';
  return row('Member', `${untrusted(member.name ?? '(no profile name)')} · user #${member.userId}${member.accountState ? ` · account ${escapeHtml(member.accountState)}` : ''}${link}`);
}

function eventsTable(events: EventLine[]): string {
  if (events.length === 0) return `<p style="margin:0 0 20px;font-size:14px;">No events have been reported for this message.</p>`;
  const head = `<tr><td style="${cell}color:${IDOC_EMAIL_COLORS.muted};">Time</td><td style="${cell}color:${IDOC_EMAIL_COLORS.muted};">Event</td><td style="${cell}color:${IDOC_EMAIL_COLORS.muted};">Brevo's reason</td></tr>`;
  return table(head + events.map((event) => `<tr><td style="${cell}white-space:nowrap;">${escapeHtml(utc(event.at))}</td><td style="${cell}">${escapeHtml(event.event)}</td><td style="${cell}">${event.reason ? untrusted(event.reason) : '—'}</td></tr>`).join(''));
}

function domainLine(context: DomainContext): string {
  if (context.total === 0) return `No other emails to ${escapeHtml(context.domain)} in the last hour.`;
  return `In the last hour: ${context.total} email${context.total === 1 ? '' : 's'} to <b>${escapeHtml(context.domain)}</b>, ${context.delivered} delivered, ${context.notDelivered} not delivered after 5 minutes.${context.notDelivered >= 2 ? ' <b>Several are stuck, so this provider may be throttling or blocking us.</b>' : ''}`;
}

const recentTable = (emails: RecentEmail[]) => emails.length === 0
  ? `<p style="margin:0 0 20px;font-size:14px;">No other emails to this address in the last 24 hours.</p>`
  : table(emails.map((email) => row(utc(email.sentAt), `${untrusted(emailKindLabel(email.kind, email.subject))} — <b>${escapeHtml(email.status)}</b>`)).join(''));

export type DeliveryProblemData = {
  baseUrl: string;
  brevoCheck: BrevoCheck;
  codeRequests: { requested: number; withEntryAttempt: number } | null;
  domain: DomainContext;
  email: { id: number; kind: string | null; messageId: string | null; messageRef: string | null; sentAt: Date; status: string; statusAt: Date; subject: string | null; to: string };
  events: EventLine[];
  member: MemberRef | null;
  now: Date;
  recent: RecentEmail[];
  tier: AlertTier;
};

/** The alert sent to IDOC_ADMIN_NOTIFICATION_EMAIL for one email that was not delivered. Carries everything needed to troubleshoot it
 * without opening anything else first. Never contains the message body, a code or a link. */
export function buildDeliveryProblemAlert(data: DeliveryProblemData): { dedupeKey: string; html: string; subject: string } {
  const { email } = data;
  const ageMinutes = Math.round((data.now.getTime() - email.sentAt.getTime()) / 60_000);
  const label = emailKindLabel(email.kind, email.subject);
  const diagnosis = diagnose({ ageMinutes, brevoCheck: data.brevoCheck, events: data.events, status: email.status });
  const heading = data.tier === 'failed' ? 'Email could not be delivered' : data.tier === 'final' ? 'Email still not delivered after 24 hours' : 'Email not delivered yet';
  const brevoCheckText = { events_found: 'IDOC asked Brevo directly and updated this record from what Brevo reported.', no_events: 'IDOC asked Brevo directly: Brevo has no events for this message.', skipped: 'Brevo was not asked (the outcome is already final).', unavailable: 'IDOC could not reach Brevo\'s log to check.' }[data.brevoCheck];
  const codeLine = data.codeRequests ? row('Codes requested for this address (last hour)', `${data.codeRequests.requested}, of which ${data.codeRequests.withEntryAttempt} had at least one code entered`) : '';
  const bodyHtml = `
<p style="margin:0 0 16px;"><b>${escapeHtml(diagnosis.summary)}</b></p>
${h('The email')}
${table([
    row('Recipient', `<b>${escapeHtml(email.to)}</b>`),
    memberRows(data.member, data.baseUrl),
    row('Type', escapeHtml(label)),
    row('Subject', untrusted(email.subject ?? '—')),
    row('Accepted by Brevo', `${escapeHtml(utc(email.sentAt))} (${ageMinutes} minutes ago)`),
    row('Status now', `<b>${escapeHtml(email.status)}</b> since ${escapeHtml(utc(email.statusAt))}`),
    row('Brevo message id', email.messageId ? code(email.messageId) : 'not recorded'),
    row('IDOC message reference', email.messageRef ? code(email.messageRef) : '—'),
    row('Deadline used', isAuthCodeKind(email.kind) ? '5 minutes (a code is only useful briefly)' : '30 minutes'),
    codeLine,
  ].join(''))}
${h('What Brevo reported')}
${eventsTable(data.events)}
<p style="margin:0 0 20px;font-size:14px;color:${IDOC_EMAIL_COLORS.muted};">${escapeHtml(brevoCheckText)}</p>
${h('Around this address')}
<p style="margin:0 0 10px;font-size:14px;">${domainLine(data.domain)}</p>
${recentTable(data.recent)}
${h('What to do')}
<ol style="margin:0 0 8px;padding-left:20px;font-size:14px;">${diagnosis.steps.map((step) => `<li style="margin:0 0 6px;">${escapeHtml(step)}</li>`).join('')}<li>Search the address in Brevo → Transactional → Logs and compare with the events above.</li></ol>`;
  return {
    dedupeKey: `email-delivery-problem:${email.id}:${data.tier}`,
    html: renderTransactionalEmail({ bodyHtml, footerNote: 'IDOC delivery monitoring. This message never contains the email body, a verification code or a link.', heading }),
    subject: `IDOC: email not delivered — ${label} to ${data.domain.domain}`,
  };
}

export type RepeatRequest = { events: EventLine[]; requestedAt: Date; status: string | null };
export type RepeatRequestData = {
  baseUrl: string;
  domain: DomainContext;
  member: MemberRef | null;
  now: Date;
  purpose: string;
  requests: RepeatRequest[];
  to: string;
};

/** The alert for a member who keeps asking for a code and never enters one, which almost always means the emails are not reaching them. */
export function buildRepeatRequestAlert(data: RepeatRequestData): { dedupeKey: string; html: string; subject: string } {
  const label = emailKindLabel(`auth.otp.${data.purpose}`, null);
  const statuses = data.requests.map((request) => request.status);
  const allDelivered = statuses.length > 0 && statuses.every((status) => status === 'delivered');
  const summary = allDelivered
    ? `Brevo reports every one of these ${data.requests.length} codes as delivered, yet the member never entered one. They most likely cannot find the email (spam/junk folder, a different mailbox, or a mail app that is slow to show it).`
    : `The member requested ${data.requests.length} ${label}s within 15 minutes and never entered one, and at least one was not reported delivered. The emails are probably not reaching them in time.`;
  const requestRows = data.requests.map((request, index) => row(`Request ${index + 1} · ${utc(request.requestedAt)}`, request.status
    ? `<b>${escapeHtml(request.status)}</b>${request.events.length ? ': ' + request.events.map((event) => `${escapeHtml(event.event)} ${escapeHtml(utc(event.at).slice(11))}${event.reason ? ` (${untrusted(event.reason)})` : ''}`).join(', ') : ''}`
    : 'no delivery record (sent before logging began, or Brevo did not accept it)')).join('');
  const bodyHtml = `
<p style="margin:0 0 16px;"><b>${escapeHtml(summary)}</b></p>
${h('The member')}
${table([row('Address', `<b>${escapeHtml(data.to)}</b>`), memberRows(data.member, data.baseUrl), row('Code type', escapeHtml(label))].join(''))}
${h('Each request and what became of its email')}
${table(requestRows)}
${h('Around this address')}
<p style="margin:0 0 20px;font-size:14px;">${domainLine(data.domain)}</p>
${h('What to do')}
<ol style="margin:0 0 8px;padding-left:20px;font-size:14px;">
<li style="margin:0 0 6px;">Contact the member: ask them to check spam/junk, request <b>one</b> code and wait a few minutes (an earlier code stays valid for a short time when they ask again).</li>
<li style="margin:0 0 6px;">Offer another way in: Google sign-in if their account has it connected, or a password reset.</li>
<li>If other members at ${escapeHtml(data.domain.domain)} are affected too, treat it as a provider-wide delivery problem (see the line above).</li></ol>`;
  const hour = new Date(Math.floor(data.now.getTime() / 3_600_000) * 3_600_000).toISOString();
  const fingerprint = createHash('sha256').update(`${data.to}:${data.purpose}:${hour}`).digest('hex');
  return {
    dedupeKey: `repeated-code-requests:${fingerprint}`,
    html: renderTransactionalEmail({ bodyHtml, footerNote: 'IDOC delivery monitoring. This message never contains a verification code.', heading: 'A member keeps requesting codes' }),
    subject: `IDOC: ${data.requests.length} ${label} requests, none entered — ${data.domain.domain}`,
  };
}

/** The single alert sent in place of the individual ones once the hourly cap is reached. */
export function buildFloodSummaryAlert(data: { baseUrl: string; held: number; now: Date }): { dedupeKey: string; html: string; subject: string } {
  const hour = new Date(Math.floor(data.now.getTime() / 3_600_000) * 3_600_000).toISOString();
  const bodyHtml = `
<p style="margin:0 0 16px;"><b>${data.held} more email${data.held === 1 ? '' : 's'} need${data.held === 1 ? 's' : ''} attention, but individual alerts are paused for this hour after ${HOURLY_ALERT_CAP}, so your inbox is not flooded.</b></p>
<p style="margin:0 0 16px;font-size:14px;">This usually means a mail provider is delaying or refusing our email for many members at once, or many undeliverable addresses were submitted. Nothing is lost: the remaining emails are reported as the cap allows over the next hours.</p>
${h('What to do')}
<ol style="margin:0 0 8px;padding-left:20px;font-size:14px;">
<li style="margin:0 0 6px;">Open <a href="${escapeHtml(`${data.baseUrl}/admin/communications`)}" style="color:${IDOC_EMAIL_COLORS.gold};">Communications → Delivery issues</a> to see every email that is not confirmed delivered, by address.</li>
<li style="margin:0 0 6px;">Look at the provider named in the individual alerts you did receive; if one provider dominates, it is throttling or blocking us.</li>
<li>Check Brevo's status and Transactional → Logs.</li></ol>`;
  return {
    dedupeKey: `email-delivery-flood:${hour}`,
    html: renderTransactionalEmail({ bodyHtml, footerNote: 'IDOC delivery monitoring.', heading: 'Email delivery alerts paused' }),
    subject: `IDOC: ${data.held} more undelivered email${data.held === 1 ? '' : 's'} — alerts paused this hour`,
  };
}
