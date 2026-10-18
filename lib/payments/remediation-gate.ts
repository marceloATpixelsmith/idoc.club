import 'server-only';

import { getDatabaseSchemaName } from '../db/schema-name.ts';
import { liveBillingDisabled } from '../runtime/member-launch-hold.ts';
import { stripeDeploymentMode } from '../runtime/stripe-configuration.mjs';

/** Whether this deployment may WRITE to Stripe on the reconciliation report's behalf (cancel orphaned subscriptions, delete unlinked customers).
 * Only the production schema, with a Stripe key whose mode matches the deployment. A test-mode deployment (for example the production schema served from a
 * non-live hostname) may write to the Stripe sandbox, where no real money or member exists; a live deployment also needs the launch hold released.
 * Staging, rehearsal reads and everything else fail it and have their Stripe actions simulated instead. */
export function remediationAllowed(environment: Partial<Record<string, string | undefined>> = process.env, schemaName: string = getDatabaseSchemaName()): boolean {
  if (schemaName !== 'idoc_production') return false;
  const mode = stripeDeploymentMode(environment);
  const keyMode = /^(?:sk|rk)_(live|test)_/.exec(environment.STRIPE_SECRET_KEY?.trim() ?? '')?.[1];
  if (!keyMode || keyMode !== mode) return false;
  return mode === 'test' || !liveBillingDisabled(environment);
}
