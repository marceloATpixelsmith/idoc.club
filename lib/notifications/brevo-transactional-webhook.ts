import { timingSafeEqual } from 'node:crypto';

// AUTH-EMAIL-007: unlike Mandrill (which HMAC-signs every webhook delivery), Brevo does not sign
// webhook deliveries at all -- no signature header, no JWT. The shared secret in BREVO_WEBHOOK_KEY is
// instead required as a `key` query parameter on the Notify URL entered into Brevo's dashboard, so an
// attacker who doesn't know it cannot forge delivery/bounce events toward this endpoint.
export function verifyBrevoWebhookKey(providedKey: string | null, webhookKey: string | undefined): boolean {
  if (!webhookKey || !providedKey) return false;
  const expectedBuffer = Buffer.from(webhookKey);
  const providedBuffer = Buffer.from(providedKey);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

// Brevo's own documented transactional event vocabulary. Only a subset is meaningful to this
// handler; every other event type (delivered, opened, click, ...) is accepted and silently ignored.
export type BrevoEventType = 'blocked' | 'click' | 'deferred' | 'delivered' | 'hardBounce' | 'invalid' | 'opened' | 'request' | 'sent' | 'softBounce' | 'spam' | 'uniqueOpened' | 'unsubscribed';

export type BrevoEvent = { event: BrevoEventType; email?: string; reason?: string };

const MAX_REASON_LENGTH = 200;

/** Parses a single Brevo webhook delivery. Unlike Mandrill (which posts one form field containing a
 * JSON array of events), Brevo posts one JSON object per HTTP request, so there is no "batch" to
 * unpack. Returns null for anything that isn't a well-formed event-shaped object, so the caller can
 * tell "unrecognized event type" (still a valid payload, just accepted and ignored) apart from
 * "malformed payload". The bounce `reason` Brevo reports is free text surfaced from the receiving
 * mail server, not a fixed short code like Mandrill's `bounce_description` -- it is length-capped
 * before it ever reaches the internal operator alert email. */
export function parseBrevoEvent(rawBody: unknown): BrevoEvent | null {
  if (!rawBody || typeof rawBody !== 'object') return null;
  const record = rawBody as Record<string, unknown>;
  if (typeof record.event !== 'string') return null;
  const email = typeof record.email === 'string' ? record.email : undefined;
  const rawReason = typeof record.reason === 'string' ? record.reason : undefined;
  return { email, event: record.event as BrevoEventType, reason: rawReason ? rawReason.slice(0, MAX_REASON_LENGTH) : undefined };
}
