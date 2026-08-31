import { createHmac, timingSafeEqual } from 'node:crypto';

// AUTH-EMAIL-007: Mandrill (Mailchimp Transactional) webhook signature verification, per Mandrill's
// documented algorithm -- for each POST parameter, in the order it was sent, append the parameter's
// name and then its (decoded) value to the webhook URL string with no delimiters, then HMAC-SHA1 the
// result with the webhook's authentication key and base64-encode it. In practice this codebase's
// webhook has exactly one form field (`mandrill_events`, a JSON string), so the signed string is
// always `${url}mandrill_events${rawJsonValue}` -- but this is written generically against whatever
// fields are actually present, not hardcoded to that one name, in case Mandrill ever adds more.
export function verifyMandrillSignature(url: string, formEntries: Iterable<[string, string]>, signatureHeader: string | null, webhookKey: string | undefined): boolean {
  if (!webhookKey || !signatureHeader) return false;
  let signedString = url;
  for (const [key, value] of formEntries) signedString += key + value;
  const expected = createHmac('sha1', webhookKey).update(signedString, 'utf8').digest('base64');
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(signatureHeader);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

// Mandrill's own documented event vocabulary. Only a subset is meaningful to this handler; every
// other event type (send, open, click, deferral, whitelist, ...) is accepted and silently ignored.
export type MandrillEventType = 'blacklist' | 'click' | 'deferral' | 'hard_bounce' | 'open' | 'reject' | 'send' | 'soft_bounce' | 'spam' | 'unsub' | 'whitelist';

export type MandrillEvent = { event: MandrillEventType; msg?: { bounce_description?: string; email?: string } };

/** Parses the single `mandrill_events` form field into a typed array. Returns null (not an empty
 * array) for anything that isn't a well-formed JSON array of event-shaped objects, so the caller can
 * tell "zero events" apart from "malformed payload" -- the latter should never be treated the same
 * as a legitimate empty batch. Deliberately does not surface `msg.diag` or any other free-form
 * provider text: only the categorical `event` type and `bounce_description` (itself one of
 * Mandrill's own fixed short codes, not free text) are ever read out of the payload. */
export function parseMandrillEvents(rawEventsField: string | undefined): MandrillEvent[] | null {
  if (!rawEventsField) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(rawEventsField); } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  const events: MandrillEvent[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || typeof (entry as { event?: unknown }).event !== 'string') return null;
    const record = entry as { event: string; msg?: unknown };
    const msg = record.msg && typeof record.msg === 'object' ? record.msg as Record<string, unknown> : undefined;
    events.push({
      event: record.event as MandrillEventType,
      msg: msg ? {
        bounce_description: typeof msg.bounce_description === 'string' ? msg.bounce_description : undefined,
        email: typeof msg.email === 'string' ? msg.email : undefined,
      } : undefined,
    });
  }
  return events;
}
