import 'server-only';

import { applyMailchimpMarketingStatus } from '@/lib/membership/marketing-preference';
import { parseMailchimpWebhook, verifyMailchimpWebhookKey } from '@/lib/notifications/mailchimp-marketing-webhook';
import { logError, logWarn } from '@/lib/observability/logger';

// Mailchimp requests the URL with GET to confirm it resolves before accepting it in the audience's
// Webhooks settings; a bare 200 keeps that check passing without a body or authentication.
export async function GET() {
  return new Response(null, { status: 200 });
}

/** Mailchimp -> member data: an unsubscribe or cleaned address clears the member's "keep me updated"
 * flag; a subscribe completes an opt-in that was waiting on the confirmation email (docs/19). This
 * route only ever writes onboarding_consents; it never touches transactional email, billing or
 * entitlement. */
export async function POST(request: Request) {
  const webhookKey = process.env.MAILCHIMP_WEBHOOK_KEY?.trim();
  if (!webhookKey) return Response.json({ error: 'Webhook configuration unavailable.' }, { status: 503 });

  const providedKey = new URL(request.url).searchParams.get('key');
  if (!verifyMailchimpWebhookKey(providedKey, webhookKey)) {
    await logError('mailchimp_webhook_authentication_failed');
    return Response.json({ error: 'Webhook authentication failed.' }, { status: 400 });
  }

  let form: URLSearchParams;
  try { form = new URLSearchParams(await request.text()); } catch {
    await logWarn('mailchimp_webhook_malformed_payload');
    return Response.json({ received: true });
  }
  const event = parseMailchimpWebhook(form);
  if (event === null) return Response.json({ received: true });

  // An event for some other audience (or a misconfigured hook) must not change this app's members.
  const audienceId = process.env.MAILCHIMP_MARKETING_AUDIENCE_ID?.trim();
  if (!audienceId || event.listId !== audienceId) {
    await logWarn('mailchimp_webhook_unexpected_audience');
    return Response.json({ received: true });
  }

  try {
    const status = event.type === 'unsubscribe' ? 'unsubscribed' : event.type === 'cleaned' ? 'cleaned' : 'subscribed';
    await applyMailchimpMarketingStatus([event.email], status, 'mailchimp_webhook');
  } catch {
    await logError('mailchimp_webhook_processing_failed');
    // A 5xx makes Mailchimp retry the delivery; the daily reconciliation is the backstop.
    return Response.json({ error: 'Webhook processing failed.' }, { status: 500 });
  }
  return Response.json({ received: true });
}
