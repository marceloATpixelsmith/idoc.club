import Stripe from 'stripe';
import { stripeKeyForServer } from '@/lib/runtime/configuration';
import 'server-only';
import { guardStripeMutations } from '@/lib/runtime/member-launch-hold';

let stripeClient: Stripe | undefined;
export function getStripeServerClient() {
  if (!stripeClient) {
    const key = stripeKeyForServer();
    const liveClient = /^(?:sk|rk)_live_/.test(key);
    stripeClient = new Stripe(key, { apiVersion: '2025-08-27.basil' });
    stripeClient = guardStripeMutations(stripeClient, liveClient);
  }
  return stripeClient;
}
