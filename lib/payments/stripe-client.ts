import Stripe from 'stripe';
import { stripeKeyForServer } from '@/lib/runtime/configuration';
import 'server-only';

let stripeClient: Stripe | undefined;
export function getStripeServerClient() {
  stripeClient ??= new Stripe(stripeKeyForServer(), { apiVersion: '2025-04-30.basil' });
  return stripeClient;
}
