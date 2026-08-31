import 'server-only';

import { notifyWebmasterOfEmailEvent } from '@/lib/notifications/bounce-complaint-alert';
import { parseMandrillEvents, verifyMandrillSignature } from '@/lib/notifications/mailchimp-transactional-webhook';
import { logError, logWarn } from '@/lib/observability/logger';

// AUTH-EMAIL-007: Mandrill (Mailchimp Transactional) posts a "test webhook" during setup and pings
// the URL to confirm it resolves before accepting it in their dashboard; a bare 200 on GET keeps
// that check passing without requiring any request body or signature.
export async function GET() {
  return new Response(null, { status: 200 });
}

export async function POST(request: Request) {
  const webhookKey = process.env.MAILCHIMP_TRANSACTIONAL_WEBHOOK_KEY;
  if (!webhookKey) return Response.json({ error: 'Webhook configuration unavailable.' }, { status: 503 });

  const form = await request.formData();
  const entries: [string, string][] = [];
  for (const [key, value] of form.entries()) entries.push([key, typeof value === 'string' ? value : '']);

  const signature = request.headers.get('x-mandrill-signature');
  if (!verifyMandrillSignature(request.url, entries, signature, webhookKey)) {
    await logError('mailchimp_webhook_signature_verification_failed', { category: 'operational' });
    return Response.json({ error: 'Webhook signature verification failed.' }, { status: 400 });
  }

  const rawEvents = form.get('mandrill_events');
  const events = parseMandrillEvents(typeof rawEvents === 'string' ? rawEvents : undefined);
  if (events === null) {
    await logWarn('mailchimp_webhook_malformed_payload', { category: 'operational' });
    return Response.json({ received: true });
  }

  for (const event of events) {
    if (!event.msg?.email) continue;
    if (event.event === 'hard_bounce') {
      await notifyWebmasterOfEmailEvent({ email: event.msg.email, kind: 'email.hard_bounce', reasonCode: event.msg.bounce_description });
    } else if (event.event === 'spam') {
      await notifyWebmasterOfEmailEvent({ email: event.msg.email, kind: 'email.spam_complaint' });
    } else if (event.event === 'soft_bounce') {
      // Transient by definition -- logged for operator visibility only, deliberately never an
      // alert email: a single soft bounce (mailbox full, greylisted, ...) is routine, and paging an
      // operator for every one of these would train them to ignore the alerts that actually matter.
      await logWarn('mailchimp_webhook_soft_bounce', { category: 'operational' });
    }
  }

  return Response.json({ received: true });
}
