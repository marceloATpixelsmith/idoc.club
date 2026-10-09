import Stripe from 'stripe';
import { stripeKeyForServer } from '@/lib/runtime/configuration';
import { getDatabaseSchemaName } from '@/lib/db/schema-name';
import 'server-only';
import { guardStripeMutations } from '@/lib/runtime/member-launch-hold';

let stripeClient: Stripe | undefined;
export function getStripeServerClient() {
  if (!stripeClient) {
    const key = stripeKeyForServer();
    const liveClient = /^(?:sk|rk)_live_/.test(key);
    if (getDatabaseSchemaName() === 'idoc_staging' && liveClient) {
      throw new Error('Refusing live Stripe credentials while DB_SCHEMA is idoc_staging.');
    }
    stripeClient = new Stripe(key, { apiVersion: '2025-08-27.basil' });
    stripeClient = guardStripeMutations(stripeClient, liveClient);
  }
  return stripeClient;
}
