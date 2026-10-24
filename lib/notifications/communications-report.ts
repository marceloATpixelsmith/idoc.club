// Pure helpers for the administrator Communications page: which emails count as renewal notices, how a
// sent email is matched against the Brevo delivery log, and how the weekly totals are built. No IO here
// so the matching rules can be unit tested; communications-report-data.ts does the database and Brevo calls.

export const RENEWAL_NOTICE_KINDS = ['membership.renewal_reminder', 'membership.expiration_reminder', 'membership.grace_reminder'] as const;

export const EMAIL_KIND_LABELS: Record<string, string> = {
  'account.migration_activation': 'Account activation (imported member)',
  'account.password_reset': 'Password reset',
  'administrator.profile_changed': 'Profile changed (admin alert)',
  'membership.expiration_reminder': 'Expiration reminder',
  'membership.grace_expired': 'Grace period ended',
  'membership.grace_reminder': 'Grace period reminder',
  'membership.manual_payment_recorded': 'Manual payment recorded',
  'membership.payment_failed': 'Payment failed / grace started',
  'membership.renewal_reminder': 'Renewal reminder',
  'seminar.payment_confirmed': 'Seminar payment confirmed',
  'seminar.refund_confirmed': 'Seminar refund confirmed',
  'seminar.registration_canceled': 'Seminar registration canceled',
  'seminar.registration_created': 'Seminar registration confirmation',
};

export function emailKindLabel(kind: string): string {
  return EMAIL_KIND_LABELS[kind] ?? kind;
}

export type BrevoEventName = 'delivered' | 'hardBounces' | 'softBounces' | 'blocked' | 'spam' | 'invalid' | 'error' | 'deferred';
export type BrevoLogEvent = { at: Date; email: string; event: BrevoEventName };

/** Events that mean the recipient did not get the message. `deferred` is retrying, so it is not a failure yet. */
const FAILURE_EVENTS: readonly BrevoEventName[] = ['hardBounces', 'softBounces', 'blocked', 'spam', 'invalid', 'error'];

export type BrevoCheck = 'delivered' | 'failed' | 'not_found' | 'unavailable';
export type SentEmail = { email: string | null; id: string; sentAt: Date };

const CLOCK_SLACK_MS = 2 * 60_000;
// Brevo reports a delivery or bounce within minutes, a deferred retry within hours; a later event for the same address belongs to a later send.
const OUTCOME_WINDOW_MS = 24 * 3_600_000;

/** Matches each sent email to the Brevo log by recipient and time. A Brevo "delivered" event is consumed by
 * the first send to that address at or before it, so two emails to one member in the window are not both
 * credited with a single delivery. Any failure event after the send wins over a delivery. */
export function checkAgainstBrevoLog(sent: SentEmail[], events: BrevoLogEvent[] | null): Map<string, BrevoCheck> {
  const result = new Map<string, BrevoCheck>();
  if (events === null) {
    for (const row of sent) result.set(row.id, 'unavailable');
    return result;
  }
  const byEmail = new Map<string, BrevoLogEvent[]>();
  for (const event of events) {
    const key = event.email.trim().toLowerCase();
    byEmail.set(key, [...(byEmail.get(key) ?? []), event]);
  }
  const consumed = new Set<BrevoLogEvent>();
  const ordered = [...sent].sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime());
  for (const [index, row] of ordered.entries()) {
    const candidates = row.email ? (byEmail.get(row.email.trim().toLowerCase()) ?? []) : [];
    // An outcome belongs to this send only until the next send to the same address (or 24 hours), so a later
    // message's bounce can never overturn an earlier delivery.
    const nextSend = ordered.slice(index + 1).find((other) => other.email !== null && other.email.trim().toLowerCase() === row.email?.trim().toLowerCase());
    const upper = Math.min(row.sentAt.getTime() + OUTCOME_WINDOW_MS, nextSend ? nextSend.sentAt.getTime() - CLOCK_SLACK_MS : Infinity);
    const after = candidates.filter((event) => event.at.getTime() >= row.sentAt.getTime() - CLOCK_SLACK_MS && event.at.getTime() <= upper).sort((left, right) => left.at.getTime() - right.at.getTime());
    const failure = after.find((event) => FAILURE_EVENTS.includes(event.event) && !consumed.has(event));
    if (failure) { consumed.add(failure); result.set(row.id, 'failed'); continue; }
    const delivered = after.find((event) => event.event === 'delivered' && !consumed.has(event));
    if (delivered) { consumed.add(delivered); result.set(row.id, 'delivered'); continue; }
    result.set(row.id, 'not_found');
  }
  return result;
}

export const BREVO_CHECK_LABELS: Record<BrevoCheck, string> = {
  delivered: 'Delivered',
  failed: 'Bounced / blocked',
  not_found: 'Not in Brevo log',
  unavailable: 'Brevo log unavailable',
};

export type KindTotals = { brevoDelivered: number; brevoFailed: number; brevoNotFound: number; brevoUnavailable: number; failedToSend: number; kind: string; label: string; pending: number; sent: number };

export type OutboxEmail = { deadLettered: boolean; email: string | null; id: string; kind: string; sentAt: Date | null };

/** Per-type weekly totals: how many were sent, how many Brevo's log confirms, and how many never left the queue. */
export function totalsByKind(rows: OutboxEmail[], checks: Map<string, BrevoCheck>): KindTotals[] {
  const totals = new Map<string, KindTotals>();
  for (const row of rows) {
    const entry = totals.get(row.kind) ?? { brevoDelivered: 0, brevoFailed: 0, brevoNotFound: 0, brevoUnavailable: 0, failedToSend: 0, kind: row.kind, label: emailKindLabel(row.kind), pending: 0, sent: 0 };
    if (row.sentAt) {
      entry.sent += 1;
      const check = checks.get(row.id);
      if (check === 'delivered') entry.brevoDelivered += 1;
      else if (check === 'failed') entry.brevoFailed += 1;
      else if (check === 'not_found') entry.brevoNotFound += 1;
      else entry.brevoUnavailable += 1;
    } else if (row.deadLettered) entry.failedToSend += 1;
    else entry.pending += 1;
    totals.set(row.kind, entry);
  }
  return [...totals.values()].sort((left, right) => left.label.localeCompare(right.label));
}

/** Date a not-yet-queued renewal notice goes out: the daily scan queues it once the target date is within
 * the notice window, so a member already inside the window is picked up by the next scan (today). */
export function noticeSendDate(targetDate: string, noticeDays: number, today: string): string {
  const target = new Date(`${targetDate}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - noticeDays);
  const scheduled = target.toISOString().slice(0, 10);
  return scheduled < today ? today : scheduled;
}
