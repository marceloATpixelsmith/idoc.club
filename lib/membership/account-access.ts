import type { Actor } from './authorization';

export type AccountState = 'active' | 'deleted' | 'migrated_pending' | 'onboarding' | 'suspended' | 'unverified';
export type AccountFunction = 'account' | 'administration' | 'billing_boundary' | 'member' | 'onboarding' | 'profile' | 'renewal';

/** Pure policy used at server boundaries; UI visibility is never an authorization decision. */
export function mayAccessAccountFunction(input: { accountState: AccountState; actor: Actor; entitled: boolean }, operation: AccountFunction) {
  if (input.accountState === 'deleted' || input.accountState === 'suspended' || input.accountState === 'migrated_pending' || input.accountState === 'unverified') return false;
  if (operation === 'administration') return input.actor.roles.includes('administrator') || input.actor.roles.includes('super_admin');
  if (input.accountState === 'onboarding') return operation === 'onboarding';
  if (operation === 'member') return input.entitled;
  // Active and expired members retain only account maintenance and future billing/renewal boundaries.
  return operation === 'account' || operation === 'profile' || operation === 'billing_boundary' || operation === 'renewal';
}
