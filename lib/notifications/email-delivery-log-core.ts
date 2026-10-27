// Pure rules for the email delivery log (docs/05, docs/07). No IO here so the vocabulary and precedence can be unit tested.

export const DELIVERY_STATUSES = ['accepted', 'deferred', 'soft_bounced', 'delivered', 'hard_bounced', 'blocked', 'invalid', 'error', 'spam'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
/** Events that only extend the history and never change an email's status. */
export type DeliveryEventName = DeliveryStatus | 'clicked' | 'opened' | 'unsubscribed';

/** A later, more final outcome replaces an earlier one; a late-arriving earlier event never downgrades it (a "deferred" reported
 * after "delivered" is history, not a regression). */
const STATUS_RANK: Record<DeliveryStatus, number> = {
  accepted: 0, deferred: 1, soft_bounced: 2, delivered: 3, error: 4, invalid: 4, blocked: 4, hard_bounced: 4, spam: 5,
};

/** Brevo spells the same event two ways: the webhook payload uses snake_case (`hard_bounce`, `soft_bounce`, `invalid_email`)
 * while its statistics API and webhook-setup API use camelCase (`hardBounces`, `softBounces`, `invalid`). Both are accepted so a
 * spelling difference can never silently drop an event. Returns null for an event this log does not track. */
export function normalizeBrevoEventName(raw: unknown): DeliveryEventName | null {
  if (typeof raw !== 'string') return null;
  switch (raw.toLowerCase().replace(/[^a-z]/g, '')) {
    case 'request': case 'requests': case 'sent': return 'accepted';
    case 'delivered': return 'delivered';
    case 'deferred': return 'deferred';
    case 'softbounce': case 'softbounces': case 'softbounced': return 'soft_bounced';
    case 'hardbounce': case 'hardbounces': case 'hardbounced': return 'hard_bounced';
    case 'blocked': return 'blocked';
    case 'invalid': case 'invalidemail': return 'invalid';
    case 'spam': case 'complaint': return 'spam';
    case 'error': return 'error';
    case 'opened': case 'uniqueopened': case 'proxyopen': case 'uniqueproxyopen': case 'loadedbyproxy': return 'opened';
    case 'click': case 'clicks': case 'clicked': return 'clicked';
    case 'unsubscribed': return 'unsubscribed';
    default: return null;
  }
}

export function isDeliveryStatus(event: DeliveryEventName): event is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(event);
}

/** The status an email should have after `event`: the event's own status when it outranks the current one, otherwise unchanged. */
export function statusAfterEvent(current: DeliveryStatus, event: DeliveryEventName): DeliveryStatus {
  if (!isDeliveryStatus(event)) return current;
  return STATUS_RANK[event] > STATUS_RANK[current] ? event : current;
}

/** Brevo's message id with the angle brackets its API and its webhook both wrap it in removed, or null when there is none. */
export function normalizeBrevoMessageId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
  return id ? id.slice(0, 200) : null;
}

export function recipientDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return (at >= 0 ? email.slice(at + 1) : email).trim().toLowerCase().slice(0, 255);
}

/** When Brevo says the event happened: `ts_event` is epoch seconds and `ts_epoch` epoch milliseconds (the human-readable `date` carries
 * no zone, so it is not used). Anything missing or implausible falls back to the moment the webhook arrived. */
export function brevoEventTime(payload: Record<string, unknown>, now: Date = new Date()): Date {
  const seconds = typeof payload.ts_event === 'number' ? payload.ts_event * 1000 : undefined;
  const millis = typeof payload.ts_epoch === 'number' ? payload.ts_epoch : undefined;
  for (const candidate of [seconds, millis]) {
    if (candidate === undefined) continue;
    const at = new Date(candidate);
    if (!Number.isNaN(at.getTime()) && Math.abs(at.getTime() - now.getTime()) < 400 * 86_400_000) return at;
  }
  return now;
}
