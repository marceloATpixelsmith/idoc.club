import 'server-only';

import Stripe from 'stripe';
import { getDatabaseSchemaName } from '@/lib/db/schema-name';
import { memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';
import { stripeDeploymentMode } from '@/lib/runtime/stripe-configuration.mjs';

// TEMPORARY legacy import rehearsal mode (docs/03 section 12): while the legacy member data is being evaluated, staging's
// billing reconciliation may read LIVE Stripe so imported live customer and subscription IDs can be compared with what
// Stripe really holds. This is a read-only facade over a separate restricted key; the application's own Stripe client
// (and the "never a live key on staging" refusal in stripe-client.ts) is untouched.

type Environment = Partial<Record<string, string | undefined>>;

const RESTRICTED_LIVE_KEY = /^rk_live_[A-Za-z0-9]{16,}$/;
const READ_METHODS = new Set(['list', 'retrieve', 'search']);
const READ_RESOURCES = new Set(['customers', 'subscriptions', 'invoices', 'subscriptionSchedules', 'charges', 'paymentIntents']);

export type RehearsalReadStatus = { active: true; key: string } | { active: false; reason: string };

/** Rehearsal reads are active only when every condition holds; otherwise nothing touches the live key. */
export function rehearsalReadStatus(environment: Environment = process.env, schemaName: string = getDatabaseSchemaName()): RehearsalReadStatus {
  const key = environment.LEGACY_STRIPE_SECRET_KEY?.trim();
  if (!key) return { active: false, reason: 'not_configured' };
  if (schemaName !== 'idoc_staging') return { active: false, reason: 'not_staging_schema' };
  if (!memberCommunicationsDisabled(environment)) return { active: false, reason: 'communications_hold_off' };
  if (stripeDeploymentMode(environment) !== 'test') return { active: false, reason: 'live_deployment' };
  if (!RESTRICTED_LIVE_KEY.test(key)) return { active: false, reason: 'not_restricted_live_key' };
  if (key === environment.STRIPE_SECRET_KEY?.trim()) return { active: false, reason: 'same_as_application_key' };
  return { active: true, key };
}

export class RehearsalReadOnlyError extends Error {
  constructor(what: string) {
    super(`Rehearsal Stripe access is read-only: ${what} is not allowed.`);
    this.name = 'RehearsalReadOnlyError';
  }
}

/** Allowlist, not blocklist: only list/retrieve/search on a few resources exist on the facade; everything else throws. */
export function restrictToReads<T extends object>(client: T): T {
  const wrapResource = (resource: object) => new Proxy(resource, {
    get(target, property) {
      if (typeof property === 'symbol' || property === 'then') return undefined;
      const value = Reflect.get(target, property, target);
      if (!READ_METHODS.has(property) || typeof value !== 'function') throw new RehearsalReadOnlyError(`${String(property)}`);
      return (...args: unknown[]) => Reflect.apply(value, target, args);
    },
  });
  return new Proxy(client, {
    get(target, property) {
      if (typeof property === 'symbol' || property === 'then') return undefined;
      if (!READ_RESOURCES.has(property)) throw new RehearsalReadOnlyError(`${String(property)}`);
      const resource = Reflect.get(target, property, target);
      return resource && typeof resource === 'object' ? wrapResource(resource) : undefined;
    },
  });
}

let readClient: Stripe | undefined;

/** The read-only live client, or null when rehearsal reads are not active (callers then use the normal client). */
export function getRehearsalReadClient(): Stripe | null {
  const status = rehearsalReadStatus();
  if (!status.active) return null;
  readClient ??= restrictToReads(new Stripe(status.key, { apiVersion: '2025-08-27.basil' }));
  return readClient;
}
