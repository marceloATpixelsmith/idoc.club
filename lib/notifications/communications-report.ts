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

export type BrevoEventName = 'requests' | 'delivered' | 'hardBounces' | 'softBounces' | 'blocked' | 'spam' | 'invalid' | 'error' | 'deferred';
/** `messageId` is Brevo's own id for the message (angle brackets removed); every event Brevo reports for one message carries the same one. */
export type BrevoLogEvent = { at: Date; email: string; event: BrevoEventName; messageId?: string };

/** Events that mean the recipient did not get the message. `deferred` is retrying, so it is not a failure yet. */
const FAILURE_EVENTS: readonly BrevoEventName[] = ['hardBounces', 'softBounces', 'blocked', 'spam', 'invalid', 'error'];

export type BrevoCheck = 'delivered' | 'failed' | 'not_found' | 'unavailable';
export type SentEmail = { email: string | null; id: string; sentAt: Date };

const CLOCK_SLACK_MS = 2 * 60_000;
// Brevo reports a delivery or bounce within minutes, a deferred retry within hours; a later event for the same address belongs to a later send.
const OUTCOME_WINDOW_MS = 24 * 3_600_000;

// Brevo reports a message's "request" (accepted) within a second or two of our send (under one second in every observed case); a delivery can
// follow minutes or hours later. A request is claimed only by the send nearest to it (within this window), so a send whose own request is
// missing cannot borrow a neighbour's.
const REQUEST_MATCH_MS = 30_000;

/** Matches each sent email to the Brevo log. Preferred: pair the send with Brevo's own "request" event for it (same address, within
 * seconds), then judge it by every event carrying that message's id, however late they arrive: a message delivered an hour later
 * is still delivered even when another email to the same address went out in between. Fallback, when the log has no request event
 * for a send: match by recipient and time, where a Brevo "delivered" event is consumed by the first send to that address at or
 * before it, so two emails to one member in the window are not both credited with a single delivery. Any failure event after the
 * send wins over a delivery. `not_found` means no delivery or failure was found, not that Brevo has no record of the message. */
export function checkAgainstBrevoLog(sent: SentEmail[], events: BrevoLogEvent[] | null): Map<string, BrevoCheck> {
  const result = new Map<string, BrevoCheck>();
  if (events === null) {
    for (const row of sent) result.set(row.id, 'unavailable');
    return result;
  }
  const byEmail = new Map<string, BrevoLogEvent[]>();
  const byMessageId = new Map<string, BrevoLogEvent[]>();
  for (const event of events) {
    const key = event.email.trim().toLowerCase();
    byEmail.set(key, [...(byEmail.get(key) ?? []), event]);
    if (event.messageId) byMessageId.set(event.messageId, [...(byMessageId.get(event.messageId) ?? []), event]);
  }
  const consumed = new Set<BrevoLogEvent>();
  const claimedRequests = new Set<BrevoLogEvent>();
  const claimedMessageIds = new Set<string>();
  const ordered = [...sent].sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime());
  const unmatched: Array<[number, SentEmail]> = [];

  // First pass: settle every send that has a request event of its own, so the time-window fallback below can never consume an outcome
  // belonging to a message that a later send already claims by id.
  for (const [index, row] of ordered.entries()) {
    const candidates = row.email ? (byEmail.get(row.email.trim().toLowerCase()) ?? []) : [];

    // Preferred: Brevo's own message id, found through the request event nearest this send.
    // Only the send nearest a request may claim it, so a send whose own request is missing falls through to the time-window fallback
    // instead of borrowing a neighbour's message id and being judged by another message's events.
    const sameAddressSends = ordered.filter((other) => other.email !== null && other.email.trim().toLowerCase() === row.email?.trim().toLowerCase());
    const nearestSendId = (event: BrevoLogEvent) => [...sameAddressSends]
      .sort((left, right) => Math.abs(event.at.getTime() - left.sentAt.getTime()) - Math.abs(event.at.getTime() - right.sentAt.getTime()))[0]?.id;
    const request = candidates
      .filter((event) => event.event === 'requests' && event.messageId && !claimedRequests.has(event) && nearestSendId(event) === row.id && Math.abs(event.at.getTime() - row.sentAt.getTime()) <= REQUEST_MATCH_MS)
      .sort((left, right) => Math.abs(left.at.getTime() - row.sentAt.getTime()) - Math.abs(right.at.getTime() - row.sentAt.getTime()))[0];
    if (request?.messageId) {
      claimedRequests.add(request);
      claimedMessageIds.add(request.messageId);
      const mine = byMessageId.get(request.messageId) ?? [];
      result.set(row.id, mine.some((event) => FAILURE_EVENTS.includes(event.event)) ? 'failed' : mine.some((event) => event.event === 'delivered') ? 'delivered' : 'not_found');
    } else unmatched.push([index, row]);
  }

  for (const [index, row] of unmatched) {
    const candidates = row.email ? (byEmail.get(row.email.trim().toLowerCase()) ?? []) : [];

    // Fallback: by recipient and time. An outcome belongs to this send only from the previous send to the same address to the next one
    // (or 24 hours), so a later message's bounce can never overturn an earlier delivery. The clock allowance only widens the start
    // of the window, never moves the next send's boundary back across this send's own delivery.
    const sameAddress = (other: SentEmail) => other.email !== null && other.email.trim().toLowerCase() === row.email?.trim().toLowerCase();
    const previousSend = ordered.slice(0, index).reverse().find(sameAddress);
    const nextSend = ordered.slice(index + 1).find(sameAddress);
    const lower = Math.max(row.sentAt.getTime() - CLOCK_SLACK_MS, previousSend ? previousSend.sentAt.getTime() : -Infinity);
    const upper = Math.min(row.sentAt.getTime() + OUTCOME_WINDOW_MS, nextSend ? nextSend.sentAt.getTime() : Infinity);
    const window = candidates.filter((event) => !(event.messageId && claimedMessageIds.has(event.messageId)) && event.at.getTime() >= lower && event.at.getTime() <= upper && !consumed.has(event)).sort((left, right) => left.at.getTime() - right.at.getTime());
    // Every outcome inside this send's window belongs to it, so a later send close behind can never pick up a leftover event.
    for (const event of window) consumed.add(event);
    if (window.some((event) => FAILURE_EVENTS.includes(event.event))) { result.set(row.id, 'failed'); continue; }
    if (window.some((event) => event.event === 'delivered')) { result.set(row.id, 'delivered'); continue; }
    result.set(row.id, 'not_found');
  }
  return result;
}

export const BREVO_CHECK_LABELS: Record<BrevoCheck, string> = {
  delivered: 'Delivered',
  failed: 'Bounced / blocked',
  not_found: 'No delivery confirmation',
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
