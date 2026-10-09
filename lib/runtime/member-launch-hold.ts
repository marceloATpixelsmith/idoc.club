import 'server-only';

import { validateStripeKey } from './stripe-configuration.mjs';

type Environment = Partial<Record<string, string | undefined>>;
export const MEMBER_LAUNCH_HOLD_CODE = 'member_launch_hold';

/** Only the exact, explicit opt-in releases the hold. Never cache deployment configuration. */
export function memberCommunicationsDisabled(environment: Environment = process.env): boolean {
  return environment.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING !== 'false';
}

export class MemberLaunchHoldError extends Error {
  readonly code = MEMBER_LAUNCH_HOLD_CODE;
  constructor() {
    super('Member communications and live billing are temporarily disabled.');
    this.name = 'MemberLaunchHoldError';
  }
}

// Callers supply fixed operation names, never identifiers, payloads or provider errors.
export function logMemberLaunchHold(action: string) {
  console.warn('[member_launch_hold]', { action });
}

export function assertMemberCommunicationsAllowed(action: string) {
  if (memberCommunicationsDisabled()) {
    logMemberLaunchHold(action);
    throw new MemberLaunchHoldError();
  }
}

/** A verified test key permits sandbox billing only. Live event evidence always takes priority. */
export function liveBillingDisabled(environment: Environment = process.env, liveEvent = false): boolean {
  if (!memberCommunicationsDisabled(environment)) return false;
  if (liveEvent) return true;
  try { return validateStripeKey(environment).mode !== 'test'; } catch { return true; }
}

export function assertLiveBillingAllowed(action: string, liveEvent = false) {
  if (liveBillingDisabled(process.env, liveEvent)) {
    logMemberLaunchHold(action);
    throw new MemberLaunchHoldError();
  }
}

/** Durable suppression at enqueue time: release never resurrects work created during a hold. */
export function communicationHoldFields(billing = false) {
  const held = billing ? liveBillingDisabled() : memberCommunicationsDisabled();
  if (!held) return {};
  logMemberLaunchHold(billing ? 'queue.billing' : 'queue.email');
  return { deadLetteredAt: new Date(), lastErrorCode: MEMBER_LAUNCH_HOLD_CODE };
}

export function communicationHoldTimestamp(billing = false): string | null {
  return communicationHoldFields(billing).deadLetteredAt?.toISOString() ?? null;
}

export function outboxDeliveryHeld(billing = false): boolean {
  const held = billing ? liveBillingDisabled() : memberCommunicationsDisabled();
  if (held) logMemberLaunchHold(billing ? 'worker.billing' : 'worker.email');
  return held;
}

/** Decorate provider resources without changing the SDK or caller's injected client. Read methods
 * keep their original receiver; a captured mutation still checks the hold at invocation time. */
export function guardStripeMutations<T extends object>(client: T, liveEvent = false): T {
  const cache = new WeakMap<object, object>();
  // Fail closed for new provider methods too; only reviewed read/verification methods bypass.
  const readOnly = new Set(['retrieve', 'list', 'search', 'listLineItems', 'constructEvent',
    'constructEventAsync', 'generateTestHeaderString', 'getApiField', 'getClientUserAgent', 'getClientUserAgentSeeded']);
  function wrap(target: object): object {
    const cached = cache.get(target);
    if (cached) return cached;
    const proxy = new Proxy(target, {
      get(resource, property) {
        const value = Reflect.get(resource, property, resource);
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            if (!readOnly.has(String(property))) assertLiveBillingAllowed('billing.stripe_mutation', liveEvent);
            return Reflect.apply(value, resource, args);
          };
        }
        return value && typeof value === 'object' ? wrap(value) : value;
      },
    });
    cache.set(target, proxy);
    return proxy;
  }
  return wrap(client) as T;
}
