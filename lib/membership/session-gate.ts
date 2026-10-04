import { isEntitled, type EntitlementRecord } from './entitlement.ts';

/** What a signed-in session may do, decided from account state and membership alone.
 *
 * - `open`: ordinary access (entitled member, administrator, or anyone this policy does not govern).
 * - `payment_only`: a member who has not paid yet, whose membership lapsed, or who has not finished
 *   onboarding. While signed in they see only the membership-payment page (or the onboarding wizard
 *   that precedes it); the public site is for signed-out visitors, so they must sign out to see it.
 * - `ended`: a member whose membership was canceled (by themselves or an administrator) and whose
 *   paid-through date has now passed. The relationship is over: they can no longer sign in at all.
 *   A canceled membership keeps working until that date, exactly like any other paid term.
 *
 * Pure and dependency-free so the decision is directly unit-testable; the database lookup that
 * feeds it lives in session-gate-loader.ts. */
export type SessionGate = 'ended' | 'open' | 'payment_only';

export function classifySessionGate(input: {
  accountState: string;
  membership: EntitlementRecord | null;
  privileged: boolean;
  today: string;
}): SessionGate {
  // Administrators are never members and are never gated by membership payment.
  if (input.privileged) return 'open';
  // Account states other than these two are refused by the sign-in and session layers themselves.
  if (input.accountState !== 'active' && input.accountState !== 'onboarding') return 'open';
  if (input.accountState === 'onboarding') return 'payment_only';
  const membership = input.membership;
  if (!membership) return 'payment_only';
  if (membership.status === 'canceled' && membership.validUntil < input.today) return 'ended';
  return isEntitled(membership, input.today) ? 'open' : 'payment_only';
}

/** Where a `payment_only` session is sent instead of any other page. */
export function paymentOnlyDestination(accountState: string): string {
  return accountState === 'onboarding' ? '/dashboard' : '/dashboard/membership';
}

const PAYMENT_ONLY_PATH_PREFIXES = [
  // The payment page, and the dashboard entry that hosts the onboarding wizard / forwards to it.
  '/dashboard/membership',
  '/onboarding',
  // The specific server routes the payment, onboarding and sign-out flows depend on, named one by
  // one rather than exempting every handler: the Stripe return and webhook, one-time UI messages,
  // the header's identity lookup, onboarding's address lookup, client error reports, health checks,
  // and the provider webhooks and scheduled jobs (which carry their own secrets and no session).
  // Everything else under /api -- account linking, administrator exports, the team and
  // table-preference handlers -- is gated like any other page.
  '/api/stripe/', '/api/ui/', '/api/user', '/api/address/', '/api/client-error', '/api/health', '/api/brevo/', '/api/cron/',
  // Authentication pages, so a signed-in member can sign out, complete step-up, or switch accounts.
  '/sign-in', '/sign-up', '/mfa', '/recover-password', '/reset-password', '/verify-email', '/activate', '/request-activation',
  // Legal documents the onboarding consent text links to.
  '/terms', '/privacy',
  '/.well-known/',
  '/_next/',
] as const;

/** Whether a `payment_only` session may reach `pathname`. Everything else redirects to the payment
 * page. Static files (anything with a file extension) are always served, since the payment page
 * itself needs its logo, fonts and scripts. */
export function paymentOnlyAllows(pathname: string): boolean {
  if (pathname === '/dashboard') return true;
  if (/\.[A-Za-z0-9]+$/.test(pathname)) return true;
  return PAYMENT_ONLY_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
}
