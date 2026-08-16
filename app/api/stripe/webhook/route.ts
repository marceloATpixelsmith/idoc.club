import Stripe from 'stripe';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { processStripeEvent } from '@/lib/payments/webhook-handlers';

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return Response.json({ error: 'Webhook configuration unavailable.' }, { status: 503 });
  const stripe = getStripeServerClient();
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed.', err);
    return Response.json(
      { error: 'Webhook signature verification failed.' },
      { status: 400 }
    );
  }

  await processStripeEvent(event, stripe);

  return Response.json({ received: true });
}
