import Stripe from 'stripe';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { processStripeEvent } from '@/lib/payments/webhook-handlers';
import { processStagingSeminarConfirmationBatch } from '@/lib/notifications/renewal-notices';
import { logError } from '@/lib/observability/logger';
import { stripeWebhookSecretForServer } from '@/lib/runtime/configuration';

export async function POST(request: Request) {
  let webhookSecret: string;
  try {
    webhookSecret = stripeWebhookSecretForServer();
  } catch {
    return Response.json({ error: 'Webhook configuration unavailable.' }, { status: 503 });
  }
  const stripe = getStripeServerClient();
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    await logError('stripe_webhook_signature_verification_failed', {
      reason: 'invalid_signature',
    });
    return Response.json(
      { error: 'Webhook signature verification failed.' },
      { status: 400 }
    );
  }

  const status = await processStripeEvent(event, stripe);

  // Staging and production share Postgres, but only production runs the scheduled notification cron.
  // Stripe seminar confirmations use a staging-only queue kind, so drain that queue here only after
  // the Stripe transaction has committed. Production cannot claim these rows because its worker does
  // not know this staging-only kind.
  const checkoutSession = event.type === 'checkout.session.completed' ? event.data.object as Stripe.Checkout.Session : null;
  const stagingOwnedEvent = checkoutSession?.metadata?.deliveryOwner === 'staging';
  if (stagingOwnedEvent) {
    const delivery = await processStagingSeminarConfirmationBatch();
    if (delivery.retryable > 0 || delivery.deadLettered > 0) {
      return Response.json({ error: 'Staging seminar confirmation delivery pending retry.' }, { status: 503 });
    }
  }

  return Response.json({ received: true, status });
}
