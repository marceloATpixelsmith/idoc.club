import 'server-only';

import type Stripe from 'stripe';
import { after } from 'next/server';
import { client } from '@/lib/db/drizzle';
import { PAYMENT_STATUS_LABELS, APPROVAL_STATUS_LABELS, type ApprovalStatus, type PaymentStatus } from '@/lib/seminars/status';
import { adminUrl, type AdminNotificationCategory, type DetailRow, preformatted, sendAdminEventEmail } from './admin-event-notifications';
import { escapeHtml } from './email-template';
import { pathWithoutQuery, scrubErrorText, shouldSendErrorNotification } from './error-report-text';

export { pathWithoutQuery };

// The event families that notify category-assigned administrators (see admin-event-notifications.ts).
// Every function here is best-effort and never throws, so a notification problem can never fail a registration,
// a webhook acknowledgement or an error response.

/** Runs after the HTTP response when a request context exists, otherwise immediately (scripts, tests, instrumentation). */
export function deferAdminNotification(work: () => Promise<unknown>): void {
  const guarded = async () => { try { await work(); } catch { /* best effort */ } };
  if (process.env.NODE_ENV === 'test') return;
  try { after(guarded); } catch { void guarded(); }
}

const money = (cents: number | null | undefined, currency: string | null | undefined) =>
  typeof cents === 'number' ? `${(cents / 100).toFixed(2)} ${(currency ?? 'eur').toUpperCase()}` : null;
const stripeTime = (seconds: number | null | undefined) => seconds ? new Date(seconds * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : null;
const stripeId = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : value?.id ?? null);

// --- Seminars -------------------------------------------------------------------------------------------------

export async function notifySeminarRegistration(registrationId: number, source: 'administrator' | 'member'): Promise<void> {
  try {
    const [row] = await client<{
      approval_status: ApprovalStatus; capacity: number; country_code: string; email: string; end_date: string | Date; first_name: string;
      is_fei: boolean; last_name: string; location: string; payment_method_canonical_id: string | null; payment_status: PaymentStatus;
      price_cents: number | null; profile_id: number; registered_at: Date; seminar_id: number; start_date: string | Date; title: string; active_count: number;
    }[]>`select r.approval_status,s.capacity,p.country_code,u.email,s.end_date,p.first_name,s.is_fei,p.last_name,s.location,r.payment_method_canonical_id,
        r.payment_status,coalesce(r.expected_amount_cents,s.member_price_cents) price_cents,p.id profile_id,r.registered_at,s.id seminar_id,s.start_date,s.title,
        (select count(*)::int from seminar_registrations x where x.seminar_id=s.id and x.registration_status='registered') active_count
      from seminar_registrations r join seminars s on s.id=r.seminar_id join profiles p on p.id=r.profile_id join users u on u.id=p.user_id
      where r.id=${registrationId}`;
    if (!row) return;
    const date = (value: string | Date) => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
    const name = `${row.first_name} ${row.last_name}`.trim();
    const details: DetailRow[] = [
      ['Seminar', row.title], ['Dates', `${date(row.start_date)} – ${date(row.end_date)}`], ['Location', row.location],
      ['Seats taken', `${row.active_count} of ${row.capacity}`], ['FEI seminar', row.is_fei ? 'Yes' : 'No'],
      ['Registrant', name], ['Email', row.email], ['Country', row.country_code], ['Member profile ID', row.profile_id],
      ['Registration ID', registrationId], ['Registered by', source === 'administrator' ? 'An administrator, on the member\'s behalf' : 'The member (self-registration)'],
      ['Registered at', row.registered_at.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')],
      ['Payment method', row.payment_method_canonical_id?.replace(/_/g, ' ')], ['Fee', money(row.price_cents, 'eur')],
      ['Payment status', PAYMENT_STATUS_LABELS[row.payment_status] ?? row.payment_status],
      ['Approval status', APPROVAL_STATUS_LABELS[row.approval_status] ?? row.approval_status],
    ];
    const link = adminUrl('/admin/seminars/registrations');
    await sendAdminEventEmail({
      action: link ? { href: link, label: 'Open seminar registrations' } : null, category: 'seminars', details,
      heading: 'New seminar registration', intro: `<b>${escapeHtml(name)}</b> is registered for <b>${escapeHtml(row.title)}</b>.`,
      kind: 'admin.seminar_registration', messageKey: `seminar-registration-${registrationId}-${Date.parse(row.registered_at.toISOString())}`,
      subject: `IDOC: new seminar registration — ${row.title} (${name})`,
    });
  } catch { /* best effort */ }
}

// --- Support inbox --------------------------------------------------------------------------------------------

export type SupportActivity = 'admin_reply' | 'closed_by_administrator' | 'closed_by_member' | 'member_reply' | 'reopened_by_administrator' | 'reopened_by_member' | 'submitted';

const SUPPORT_ACTIVITY_COPY: Record<SupportActivity, { heading: string; intro: string; subject: string }> = {
  admin_reply: { heading: 'Support reply sent', intro: 'An administrator replied to a support conversation.', subject: 'support reply sent' },
  closed_by_administrator: { heading: 'Support conversation closed', intro: 'An administrator closed a support conversation.', subject: 'support conversation closed' },
  closed_by_member: { heading: 'Support conversation closed by the member', intro: 'The member closed their own support conversation.', subject: 'support conversation closed by member' },
  member_reply: { heading: 'Member replied to support', intro: 'A member replied in an existing support conversation.', subject: 'member reply in support' },
  reopened_by_administrator: { heading: 'Support conversation reopened', intro: 'An administrator reopened a support conversation.', subject: 'support conversation reopened' },
  reopened_by_member: { heading: 'Support conversation reopened by the member', intro: 'The member reopened their own support conversation.', subject: 'support conversation reopened by member' },
  submitted: { heading: 'New support conversation', intro: 'A member submitted a new support conversation.', subject: 'new support conversation' },
};

/** Emails the administrators assigned to the conversation's category. `actorUserId` is excluded from the recipients. */
export async function notifySupportActivity(input: { activity: SupportActivity; actorUserId: number; /** The message that triggered the event; its text is what the email shows, not whatever is newest by the time it is sent. */ messageId?: number | null; publicId: string }): Promise<void> {
  try {
    const [row] = await client<{
      category: AdminNotificationCategory; email: string; first_name: string | null; last_name: string | null; message_body: string | null;
      message_id: number | null; status: string; subject: string;
    }[]>`select c.category,c.status,c.subject,coalesce(u.email_display,u.email) email,p.first_name,p.last_name,lm.id message_id,lm.body message_body
      from support_conversations c join users u on u.id=c.member_user_id left join profiles p on p.user_id=u.id
      left join support_messages lm on lm.id=${input.messageId ?? null} and lm.conversation_id=c.id
      where c.public_id=${input.publicId}::uuid`;
    if (!row) return;
    const copy = SUPPORT_ACTIVITY_COPY[input.activity];
    const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
    const hasMessage = input.activity === 'submitted' || input.activity === 'member_reply' || input.activity === 'admin_reply';
    const link = adminUrl(`/admin/support/${input.publicId}`);
    await sendAdminEventEmail({
      action: link ? { href: link, label: 'Open conversation' } : null, category: row.category, excludeUserId: input.actorUserId,
      details: [['Subject', row.subject], ['Category', row.category.replace(/_/g, ' ')], ['Member', name], ['Member email', row.email], ['Status', row.status.replace(/_/g, ' ')]],
      extraSections: hasMessage && row.message_body ? [{ bodyHtml: preformatted(row.message_body), title: 'Message' }] : [],
      heading: copy.heading, intro: escapeHtml(copy.intro), kind: 'admin.support_activity',
      messageKey: `support-${input.publicId}-${input.activity}-${row.message_id ?? 0}-${Date.now()}`,
      subject: `IDOC: ${copy.subject} — ${row.subject}`,
    });
  } catch { /* best effort */ }
}

// --- Technical errors -----------------------------------------------------------------------------------------

export interface TechnicalErrorReport {
  digest?: string | null;
  error?: unknown;
  /** 'server' for exceptions caught by Next.js, 'browser' for a client error boundary, or the failing subsystem. */
  source: string;
  context?: readonly DetailRow[];
  method?: string | null;
  path?: string | null;
  requestId?: string | null;
  routeType?: string | null;
  userAgent?: string | null;
  user?: { email?: string | null; id?: number | null } | null;
}

export async function notifyTechnicalError(report: TechnicalErrorReport): Promise<void> {
  try {
    const error = report.error instanceof Error ? report.error : null;
    const message = scrubErrorText(error?.message ?? (typeof report.error === 'string' ? report.error : 'No error message was captured.'));
    const path = pathWithoutQuery(report.path);
    const signature = `${report.source}|${path ?? ''}|${error?.name ?? ''}|${message.slice(0, 160)}`;
    if (!shouldSendErrorNotification(signature, Date.now(), report.source === 'browser' ? 'browser' : 'server')) return;
    const details: DetailRow[] = [
      ['Where', report.source === 'browser' ? 'In the visitor\'s browser (error boundary)' : report.source === 'server' ? 'On the server' : report.source],
      ['Error type', error?.name], ['Message', message], ['Page / route', path], ['HTTP method', report.method], ['Route type', report.routeType],
      ['Signed-in user', report.user?.email ?? (report.user?.id ? `User ID ${report.user.id}` : report.user === null ? 'Not signed in' : null)],
      ['Request ID', report.requestId], ['Error digest', report.digest], ['Browser / client', report.userAgent?.slice(0, 300)],
      ...(report.context ?? []),
    ];
    if (report.user?.id && !report.user.email) {
      const [account] = await client<{ email: string }[]>`select email from users where id=${report.user.id}`;
      if (account) details.splice(details.findIndex(([label]) => label === 'Signed-in user'), 1, ['Signed-in user', `${account.email} (user ID ${report.user.id})`]);
    }
    const stack = error?.stack ? scrubErrorText(error.stack).split('\n').slice(0, 25).join('\n') : null;
    await sendAdminEventEmail({
      category: 'technical_support', details, extraSections: stack ? [{ bodyHtml: preformatted(stack), title: 'Stack trace' }] : [],
      footerNote: 'The Request ID and digest match the Vercel function logs and the Sentry event for this error. Repeats of the same error are suppressed for 15 minutes. Query strings, cookies and tokens are removed before sending.',
      heading: 'Application error reported',
      intro: `A ${report.source === 'browser' ? 'visitor hit an error in the browser' : 'request failed with an error'}${path ? ` at <code>${escapeHtml(path)}</code>` : ''}. Details are below so Technical Support can investigate.`,
      kind: 'admin.technical_error', messageKey: `technical-error-${Date.now()}`,
      subject: `IDOC: application error${path ? ` at ${path}` : ''} — ${message.slice(0, 80)}`,
    });
  } catch { /* best effort */ }
}

// --- Billing / Stripe -----------------------------------------------------------------------------------------

async function memberForCustomer(customerId: string | null): Promise<DetailRow[]> {
  if (!customerId) return [];
  try {
    const [row] = await client<{ email: string; first_name: string; last_name: string; profile_id: number; status: string | null; valid_until: string | Date | null }[]>`
      select u.email,p.first_name,p.last_name,p.id profile_id,
        (select m.status from memberships m where m.profile_id=p.id order by m.valid_until desc limit 1) status,
        (select m.valid_until from memberships m where m.profile_id=p.id order by m.valid_until desc limit 1) valid_until
      from billing_accounts b join profiles p on p.id=b.profile_id join users u on u.id=p.user_id where b.external_customer_id=${customerId} limit 1`;
    if (!row) return [['Stripe customer', customerId], ['Member', 'No IDOC member is linked to this Stripe customer']];
    return [['Member', `${row.first_name} ${row.last_name}`.trim()], ['Member email', row.email], ['Member profile ID', row.profile_id],
      ['Membership status', row.status], ['Valid until', row.valid_until ? String(row.valid_until instanceof Date ? row.valid_until.toISOString() : row.valid_until).slice(0, 10) : null],
      ['Stripe customer', customerId]];
  } catch { return [['Stripe customer', customerId]]; }
}

const BILLING_EVENT_TITLES: Record<string, string> = {
  'charge.dispute.created': 'Payment dispute opened',
  'checkout.session.async_payment_failed': 'Delayed payment failed',
  'invoice.payment_action_required': 'Payment needs customer action',
  'invoice.payment_failed': 'Membership renewal payment failed',
  'payment_intent.payment_failed': 'Payment declined or failed',
  'refund.failed': 'Refund failed',
};
/** Stripe event types that mean a payment was not successful; the webhook subscription must include all of them. */
export const BILLING_ALERT_EVENT_TYPES = Object.keys(BILLING_EVENT_TITLES);

export async function notifyBillingStripeEvent(event: Stripe.Event): Promise<void> {
  const title = BILLING_EVENT_TITLES[event.type];
  if (!title) return;
  try {
    const details: DetailRow[] = [['Stripe event', event.type], ['Stripe event ID', event.id], ['Mode', event.livemode ? 'Live' : 'Test'], ['Stripe time', stripeTime(event.created)]];
    let customer: string | null = null;
    let explanation = '';
    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const failure = intent.last_payment_error;
      customer = stripeId(intent.customer);
      explanation = 'A card or payment method was declined or the payment could not be completed.';
      details.push(['Amount', money(intent.amount, intent.currency)], ['Failure reason', failure?.message], ['Error code', failure?.code], ['Decline code', failure?.decline_code],
        ['Error type', failure?.type], ['Payment method type', failure?.payment_method?.type], ['Card brand', failure?.payment_method?.card?.brand],
        ['Card last 4', failure?.payment_method?.card?.last4], ['Card country', failure?.payment_method?.card?.country], ['Payment intent', intent.id],
        ['Description', intent.description], ['Purpose', intent.metadata?.kind], ['Seminar registration ID', intent.metadata?.registrationId], ['Receipt email', intent.receipt_email]);
    } else if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_action_required') {
      const invoice = event.data.object as Stripe.Invoice;
      customer = stripeId(invoice.customer as string | { id: string } | null);
      explanation = event.type === 'invoice.payment_failed'
        ? 'The automatic membership renewal charge failed. The membership moves to its grace period if it was active; Stripe may retry the charge.'
        : 'The renewal payment needs the member to complete an authentication step (for example 3-D Secure) before it can succeed.';
      details.push(['Invoice', invoice.number ?? invoice.id], ['Amount due', money(invoice.amount_due, invoice.currency)], ['Attempt number', invoice.attempt_count],
        ['Next automatic retry', stripeTime(invoice.next_payment_attempt)], ['Billing reason', invoice.billing_reason], ['Customer email on invoice', invoice.customer_email],
        ['Billing period start', stripeTime(invoice.period_start)], ['Hosted invoice page', invoice.hosted_invoice_url]);
    } else if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session;
      customer = stripeId(session.customer);
      explanation = 'A payment that was still pending after checkout (for example a bank debit) ultimately failed.';
      details.push(['Amount', money(session.amount_total, session.currency)], ['Checkout session', session.id], ['Purpose', session.metadata?.kind],
        ['Seminar registration ID', session.metadata?.registrationId], ['Customer email', session.customer_details?.email]);
    } else if (event.type === 'charge.dispute.created') {
      const dispute = event.data.object as Stripe.Dispute;
      explanation = 'A cardholder disputed a charge with their bank. Evidence must be submitted in Stripe before the deadline.';
      details.push(['Amount', money(dispute.amount, dispute.currency)], ['Reason', dispute.reason], ['Dispute status', dispute.status], ['Evidence due by', stripeTime(dispute.evidence_details?.due_by)],
        ['Dispute', dispute.id], ['Payment intent', stripeId(dispute.payment_intent)]);
    } else if (event.type === 'refund.failed') {
      const refund = event.data.object as Stripe.Refund;
      explanation = 'A refund that was issued could not be completed by Stripe or the card issuer.';
      details.push(['Amount', money(refund.amount, refund.currency)], ['Failure reason', refund.failure_reason], ['Refund', refund.id], ['Payment intent', stripeId(refund.payment_intent)]);
    }
    details.push(...(await memberForCustomer(customer)));
    const link = adminUrl('/admin/support');
    await sendAdminEventEmail({
      action: link ? { href: link, label: 'Open support inbox' } : null, category: 'billing_membership', details,
      footerNote: 'Open the event in the Stripe Dashboard (search for the Stripe event ID) for the complete record. Card numbers are never available to IDOC; only the brand and last four digits that Stripe reports are shown.',
      heading: title, intro: escapeHtml(explanation), kind: 'admin.billing_payment_issue', messageKey: `billing-${event.id}`,
      subject: `IDOC: ${title.toLowerCase()}${event.livemode ? '' : ' (test mode)'}`,
    });
  } catch { /* best effort */ }
}

/** A checkout the member could not even start (Stripe rejected or failed the Checkout Session request). */
export async function notifyCheckoutStartFailure(input: { error: unknown; kind: 'membership' | 'seminar'; profileId?: number | null; registrationId?: number | null; extra?: readonly DetailRow[] }): Promise<void> {
  try {
    const error = input.error instanceof Error ? input.error : null;
    const stripeError = error as (Error & { code?: string; decline_code?: string; type?: string; statusCode?: number; requestId?: string }) | null;
    const details: DetailRow[] = [
      ['Checkout', input.kind === 'seminar' ? 'Seminar registration payment' : 'Membership payment'], ['Problem', scrubErrorText(error?.message ?? 'Unknown error')],
      ['Stripe error type', stripeError?.type], ['Stripe error code', stripeError?.code], ['HTTP status', stripeError?.statusCode], ['Stripe request ID', stripeError?.requestId],
      ['Seminar registration ID', input.registrationId], ...(input.extra ?? []),
    ];
    if (input.profileId) {
      const [row] = await client<{ email: string; first_name: string; last_name: string }[]>`select u.email,p.first_name,p.last_name from profiles p join users u on u.id=p.user_id where p.id=${input.profileId}`;
      if (row) details.push(['Member', `${row.first_name} ${row.last_name}`.trim()], ['Member email', row.email], ['Member profile ID', input.profileId]);
    }
    const link = adminUrl('/admin/support');
    await sendAdminEventEmail({
      action: link ? { href: link, label: 'Open support inbox' } : null, category: 'billing_membership', details,
      heading: 'Member could not start a payment', intro: 'Stripe did not create the checkout page for a member, so no payment was taken. The member saw an error and may contact support.',
      kind: 'admin.billing_payment_issue', messageKey: `checkout-failure-${input.kind}-${input.registrationId ?? input.profileId ?? 'x'}-${Date.now()}`,
      subject: `IDOC: ${input.kind} checkout could not be started`,
    });
  } catch { /* best effort */ }
}
