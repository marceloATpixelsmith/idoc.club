import type { Actor } from './authorization';

export type AccountState = 'active' | 'deleted' | 'migrated_pending' | 'onboarding' | 'suspended' | 'unverified';
// 'account'/'profile' are the read-only, always-permitted-once-authenticated operations (own basic
// identity/membership-state display, sign-out, viewing another member's profile as an admin) --
// docs/25 section 1 grants a never-paid or post-grace-expired account exactly this plus payment,
// nothing more. 'account_mutation'/'profile_mutation' are their real-write counterparts (change
// password, delete account, edit profile fields, link/unlink Google, forget a remembered device,
// replace an authenticator) and additionally require current entitlement -- unless the actor is
// privileged, since an administrator correcting a member's own profile is never themselves that
// member's entitlement.
export type AccountFunction = 'account' | 'account_mutation' | 'administration' | 'billing_boundary' | 'member' | 'onboarding' | 'profile' | 'profile_mutation' | 'renewal';

/** An administrator/super_admin is never a member and must never be gated by membership payment
 * status anywhere -- the dashboard paywall included. Shared here so every call site (the account
 * policy below, and each dashboard page's own paywall check) agrees on exactly the same definition. */
export function isPrivilegedActor(actor: Actor): boolean {
  return actor.roles.includes('administrator') || actor.roles.includes('super_admin');
}

/** Pure policy used at server boundaries; UI visibility is never an authorization decision. */
export function mayAccessAccountFunction(input: { accountState: AccountState; actor: Actor; entitled: boolean }, operation: AccountFunction) {
  if (input.accountState === 'deleted' || input.accountState === 'suspended' || input.accountState === 'migrated_pending' || input.accountState === 'unverified') return false;
  const privileged = isPrivilegedActor(input.actor);
  if (operation === 'administration') return privileged;
  if (input.accountState === 'onboarding') return operation === 'onboarding';
  // Own-account activity history is read-only and not itself membership content -- an
  // administrator/super_admin reading their own activity log is never gated by their own
  // (irrelevant) entitlement either.
  if (operation === 'member') return input.entitled || privileged;
  if (operation === 'account_mutation' || operation === 'profile_mutation') return input.entitled || privileged;
  // Active and expired members retain read-only account/profile access, sign-out, and future
  // billing/renewal boundaries even without current entitlement.
  return operation === 'account' || operation === 'profile' || operation === 'billing_boundary' || operation === 'renewal';
}
