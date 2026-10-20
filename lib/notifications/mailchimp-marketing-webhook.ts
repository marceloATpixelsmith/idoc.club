import { timingSafeEqual } from 'node:crypto';

// Mailchimp does not sign webhook deliveries either. The shared secret in MAILCHIMP_WEBHOOK_KEY is
// required as a `key` query parameter on the URL entered in the audience's Webhooks settings, so a
// caller who does not know it cannot forge unsubscribe events toward this endpoint.
export function verifyMailchimpWebhookKey(providedKey: string | null, webhookKey: string | undefined): boolean {
  if (!webhookKey || !providedKey) return false;
  const expected = Buffer.from(webhookKey);
  const provided = Buffer.from(providedKey);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export type MailchimpWebhookEventType = 'cleaned' | 'subscribe' | 'unsubscribe';

export type MailchimpWebhookEvent = { email: string; listId: string; type: MailchimpWebhookEventType };

const EVENT_TYPES: readonly string[] = ['cleaned', 'subscribe', 'unsubscribe'];

/**
 * Parses one Mailchimp webhook delivery. Mailchimp posts `application/x-www-form-urlencoded`
 * (`type`, `fired_at`, `data[email]`, `data[list_id]`, ...), not JSON. Returns null for anything
 * that is not a well-formed event of a type this app acts on (profile, upemail, campaign, ... are
 * valid deliveries that are simply ignored), so the route can answer 200 without acting.
 */
export function parseMailchimpWebhook(form: URLSearchParams): MailchimpWebhookEvent | null {
  const type = form.get('type');
  const email = form.get('data[email]')?.trim().toLowerCase();
  const listId = form.get('data[list_id]')?.trim();
  if (!type || !EVENT_TYPES.includes(type) || !email || !listId) return null;
  return { email, listId, type: type as MailchimpWebhookEventType };
}
