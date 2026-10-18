import 'server-only';

import { getDatabaseSchemaName } from '../db/schema-name.ts';
import { liveBillingDisabled } from '../runtime/member-launch-hold.ts';
import { stripeDeploymentMode } from '../runtime/stripe-configuration.mjs';

/** Whether this deployment may WRITE to Stripe on the reconciliation report's behalf (cancel orphaned subscriptions, delete unlinked customers).
 * Only the production schema, with a Stripe key whose mode matches the deployment. A test-mode deployment (for example the production schema served from a
 * non-live hostname) may write to the Stripe sandbox, where no real money or member exists; a live deployment also needs the launch hold released.
 * Staging, rehearsal reads and everything else fail it and have their Stripe actions simulated instead. */
export function remediationAllowed(environment: Partial<Record<string, string | undefined>> = process.env, schemaName: string = getDatabaseSchemaName()): boolean {
  return stripeActionStatus(environment, schemaName).apply;
}

/** `safeguard` marks the one case an operator can fix by hand: everything else allows live Stripe changes, but the import-verified switch is still off. */
export type StripeActionStatus = { apply: boolean; reason: 'allowed' | 'environment' | 'safeguard' };

/** The import-verified safeguard: real Stripe changes against a LIVE key (cancelling subscriptions, deleting customers) also need
 * RECONCILIATION_LIVE_STRIPE_ACTIONS to be exactly `enabled`. It is off by default, so the first live scan after launch only simulates until an operator has
 * checked that the legacy import is complete. Sandbox (test-mode) deployments are not affected. */
export function stripeActionStatus(environment: Partial<Record<string, string | undefined>> = process.env, schemaName: string = getDatabaseSchemaName()): StripeActionStatus {
  if (schemaName !== 'idoc_production') return { apply: false, reason: 'environment' };
  const mode = stripeDeploymentMode(environment);
  const keyMode = /^(?:sk|rk)_(live|test)_/.exec(environment.STRIPE_SECRET_KEY?.trim() ?? '')?.[1];
  if (!keyMode || keyMode !== mode) return { apply: false, reason: 'environment' };
  if (mode === 'test') return { apply: true, reason: 'allowed' };
  if (liveBillingDisabled(environment)) return { apply: false, reason: 'environment' };
  return environment.RECONCILIATION_LIVE_STRIPE_ACTIONS === 'enabled' ? { apply: true, reason: 'allowed' } : { apply: false, reason: 'safeguard' };
}
