import 'server-only';

import Stripe from 'stripe';

/** Updates an existing Stripe identity; it never creates a Customer or Subscription. */
export async function updateStripeCustomerEmail(customerId: string, email: string) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return;
  await new Stripe(key).customers.update(customerId, { email });
}
