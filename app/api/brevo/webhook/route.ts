import 'server-only';

import { notifyWebmasterOfEmailEvent } from '@/lib/notifications/bounce-complaint-alert';
import { parseBrevoDeliveryEvent, parseBrevoEvent, verifyBrevoWebhookKey } from '@/lib/notifications/brevo-transactional-webhook';
import { normalizeBrevoEventName } from '@/lib/notifications/email-delivery-log-core';
import { applyBrevoDeliveryEvent } from '@/lib/notifications/email-delivery-log';
import { logError, logWarn } from '@/lib/observability/logger';

// AUTH-EMAIL-007: Brevo pings the configured Notify URL to confirm it resolves before accepting it
// in their dashboard; a bare 200 on GET keeps that check passing without requiring any request body
// or authentication.
export async function GET() {
  return new Response(null, { status: 200 });
}

export async function POST(request: Request) {
  const webhookKey = process.env.BREVO_WEBHOOK_KEY;
  if (!webhookKey) return Response.json({ error: 'Webhook configuration unavailable.' }, { status: 503 });

  const providedKey = new URL(request.url).searchParams.get('key');
  if (!verifyBrevoWebhookKey(providedKey, webhookKey)) {
    await logError('brevo_webhook_authentication_failed');
    return Response.json({ error: 'Webhook authentication failed.' }, { status: 400 });
  }

  let rawBody: unknown;
  try { rawBody = await request.json(); } catch {
    await logWarn('brevo_webhook_malformed_payload');
    return Response.json({ received: true });
  }
  const event = parseBrevoEvent(rawBody);
  if (event === null) {
    await logWarn('brevo_webhook_malformed_payload');
    return Response.json({ received: true });
  }

  // Brevo's webhook payload spells events snake_case (`hard_bounce`) while its APIs use camelCase (`hardBounces`); match on the
  // normalized name so neither spelling can silently skip an alert.
  const eventName = normalizeBrevoEventName(event.event);
  if (event.email) {
    if (eventName === 'hard_bounced') {
      await notifyWebmasterOfEmailEvent({ email: event.email, kind: 'email.hard_bounce', reasonCode: event.reason });
    } else if (eventName === 'spam') {
      await notifyWebmasterOfEmailEvent({ email: event.email, kind: 'email.spam_complaint' });
    } else if (eventName === 'soft_bounced') {
      // Transient by definition -- logged for operator visibility only, deliberately never an
      // alert email: a single soft bounce (mailbox full, greylisted, ...) is routine, and paging an
      // operator for every one of these would train them to ignore the alerts that actually matter.
      await logWarn('brevo_webhook_soft_bounce');
    }
  }

  // Record what became of the email in the delivery log. Best effort: Brevo only needs a 200, and a failure here must not make it
  // retry the whole event (the alerts above already ran).
  const delivery = parseBrevoDeliveryEvent(rawBody);
  if (delivery) {
    try { await applyBrevoDeliveryEvent(delivery); } catch { await logWarn('brevo_webhook_delivery_log_failed'); }
  }

  return Response.json({ received: true });
}
