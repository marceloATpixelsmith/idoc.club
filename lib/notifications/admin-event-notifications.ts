import 'server-only';

import { client } from '@/lib/db/drizzle';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { type AlertKind, taggedSubject } from './alert-severity';
import { sendTransactionalEmail } from './brevo-transactional';
import { emailButton, emailNoticeCard, escapeHtml, IDOC_EMAIL_COLORS, renderTransactionalEmail } from './email-template';

// Category-routed administrator notifications. The recipients are exactly the administrators and super
// administrators assigned to a support-ticket category on /admin/support/defaults, so one assignment screen
// controls both who receives tickets and who is told about matching events:
//   seminars          -> a member registers for (or is registered for) a seminar
//   technical_support -> an application error a visitor or member ran into
//   billing_membership-> a Stripe payment that failed, was declined or otherwise did not succeed
//   any support category -> a support conversation was submitted, replied to, closed or reopened (matching its category)
// Delivery is best-effort and bounded: it never throws and never delays or changes the user-facing action that
// triggered it. When no administrator is assigned to the category it falls back to the operations mailbox.

export type AdminNotificationCategory = 'billing_membership' | 'other' | 'seminars' | 'suggestion' | 'technical_support';
export type DetailRow = readonly [label: string, value: string | number | null | undefined];

// The structured logger requires a request context and a pre-registered event name; these notifications also fire from
// instrumentation and webhook code, so they log only a categorical line (never message content) directly.
function warn(event: string, meta: Record<string, string>) {
  console.warn(`[admin-notification] ${event}`, meta);
}

const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_VALUE_LENGTH = 1_500;

/** `excludeUserId` omits the administrator who performed the action, but never triggers the operations-mailbox fallback. */
export async function listCategoryRecipientEmails(category: AdminNotificationCategory, excludeUserId?: number | null): Promise<string[]> {
  const rows = await client<{ email: string; id: number }[]>`select distinct u.id,u.email from support_category_defaults d
    join users u on u.id=d.administrator_user_id and u.account_state='active'
    where d.category=${category}
      and exists(select 1 from application_roles r where r.user_id=u.id and r.revoked_at is null and r.role in ('administrator','super_admin'))`;
  const emails = rows.filter((row) => row.id !== excludeUserId).map((row) => row.email).filter(Boolean);
  if (rows.length > 0) return emails;
  const fallback = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL?.trim();
  return fallback ? [fallback] : [];
}

function clip(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}… (truncated)` : value;
}

/** A labelled key/value table. Empty values are omitted so the email only states what is actually known. */
export function detailTable(rows: readonly DetailRow[]): string {
  const body = rows.filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '').map(([label, value]) =>
    `<tr><td style="padding:10px 14px;border-bottom:1px solid ${IDOC_EMAIL_COLORS.border};width:36%;vertical-align:top;color:${IDOC_EMAIL_COLORS.gold};font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;">${escapeHtml(label)}</td>`
    + `<td style="padding:10px 14px;border-bottom:1px solid ${IDOC_EMAIL_COLORS.border};vertical-align:top;color:${IDOC_EMAIL_COLORS.text};font-size:15px;line-height:1.5;word-break:break-word;">${escapeHtml(clip(String(value)))}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${IDOC_EMAIL_COLORS.background}" style="width:100%;margin:20px 0;border-collapse:separate;border-spacing:0;background:${IDOC_EMAIL_COLORS.background};border:1px solid ${IDOC_EMAIL_COLORS.border};border-radius:8px;">${body}</table>`;
}

export function preformatted(value: string): string {
  return `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:Consolas,Menlo,monospace;font-size:12.5px;line-height:1.5;color:${IDOC_EMAIL_COLORS.text};">${escapeHtml(clip(value))}</pre>`;
}

export function adminUrl(path: string): string | null {
  try {
    return `${baseUrlForServer().replace(/\/+$/, '')}${path}`;
  } catch {
    return null;
  }
}

export interface AdminEventEmail {
  action?: { href: string; label: string } | null;
  category: AdminNotificationCategory;
  details: readonly DetailRow[];
  /** Extra titled blocks (for example a stack trace) rendered after the details table. */
  extraSections?: readonly { bodyHtml: string; title: string }[];
  /** The administrator who caused the event; they are not emailed about their own action. */
  excludeUserId?: number | null;
  footerNote?: string;
  heading: string;
  intro: string;
  kind: AlertKind;
  /** Stable per-event key so one event sends one message per recipient, even if its trigger is retried. */
  messageKey: string;
  subject: string;
}

/** Sends one branded email to every recipient assigned to the category. Never throws; resolves to the number sent. */
export async function sendAdminEventEmail(event: AdminEventEmail): Promise<number> {
  try {
    const recipients = await listCategoryRecipientEmails(event.category, event.excludeUserId);
    if (recipients.length === 0) {
      warn('no_recipient', { category: event.category, kind: event.kind });
      return 0;
    }
    const occurredAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    const html = renderTransactionalEmail({
      bodyHtml: `<p style="margin:0 0 8px;">${event.intro}</p>${detailTable([...event.details, ['Occurred', occurredAt]])}`
        + (event.extraSections ?? []).map((section) => emailNoticeCard(section.title, section.bodyHtml)).join('')
        + (event.action ? emailButton(event.action.href, event.action.label) : ''),
      footerNote: escapeHtml(event.footerNote ?? 'You receive this because you are assigned to this category on the IDOC support ticketing defaults page.'),
      heading: event.heading,
    });
    const subject = taggedSubject(event.kind, event.subject);
    const results = await Promise.allSettled(recipients.map((to, index) => sendTransactionalEmail(
      { html, messageId: `${event.messageKey}:${index}`, subject, to },
      { signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS) },
    )));
    const sent = results.filter((result) => result.status === 'fulfilled').length;
    if (sent < recipients.length) warn('delivery_failed', { category: event.category, kind: event.kind });
    return sent;
  } catch {
    warn('failed', { category: event.category, kind: event.kind });
    return 0;
  }
}
