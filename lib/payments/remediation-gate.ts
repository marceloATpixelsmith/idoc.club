import 'server-only';

import { getDatabaseSchemaName } from '../db/schema-name.ts';
import { liveBillingDisabled } from '../runtime/member-launch-hold.ts';
import { stripeDeploymentMode } from '../runtime/stripe-configuration.mjs';

/** True only for the production schema, a live deployment and a released billing hold. Anything that writes to Stripe on behalf of the
 * reconciliation report (cancelling orphaned subscriptions, deleting unlinked customers) must pass this first; staging, rehearsal
 * reads, test keys and the launch hold all fail it. */
export function remediationAllowed(environment: Partial<Record<string, string | undefined>> = process.env, schemaName: string = getDatabaseSchemaName()): boolean {
  if (schemaName !== 'idoc_production') return false;
  if (stripeDeploymentMode(environment) !== 'live') return false;
  if (!/^(?:sk|rk)_live_/.test(environment.STRIPE_SECRET_KEY?.trim() ?? '')) return false;
  return !liveBillingDisabled(environment);
}
