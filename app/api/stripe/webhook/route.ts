import Stripe from 'stripe';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { processStripeEvent } from '@/lib/payments/webhook-handlers';
import { logError } from '@/lib/observability/logger';

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return Response.json({ error: 'Webhook configuration unavailable.' }, { status: 503 });
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

  await processStripeEvent(event, stripe);

  return Response.json({ received: true });
}
