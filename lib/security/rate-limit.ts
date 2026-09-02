import 'server-only';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { rateLimitHashKeyForServer } from '@/lib/runtime/configuration';
import { correlateRepeatedRateLimitExceedance } from '@/lib/notifications/rate-limit-correlation';
import { resolveRequestOrigin } from './request-origin';
import { testRequestOrigin } from '@/lib/auth/request-cookies';

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_MAX_REQUESTS = 3;
const IP_MAX_REQUESTS = 10;
const PROVIDER_USER_MAX_REQUESTS = 60;
const PROVIDER_ORIGIN_MAX_REQUESTS = 180;

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function takeBucket(purpose: string, identifierHash: string, originHash: string, windowStartedAt: Date, max: number) {
  const rows = await db.execute<{ request_count: number }>(sql`
    insert into idoc.account_request_limits (purpose, identifier_hash, origin_hash, window_started_at)
    values (${purpose}, ${identifierHash}, ${originHash}, ${windowStartedAt.toISOString()})
    on conflict (purpose, identifier_hash, origin_hash, window_started_at)
    do update set request_count = idoc.account_request_limits.request_count + 1, updated_at = now()
    returning request_count
  `);
  return Boolean(rows[0] && rows[0].request_count <= max);
}

/** Enforces two independent limits per purpose against the existing account_request_limits table:
 * one keyed only by the normalized email (a constant origin marker takes the place of the real
 * origin), one keyed only by the request origin/IP (a constant email marker takes the place of the
 * real email) -- so rotating either dimension alone (many emails from one IP, or one email across
 * many IPs) cannot be used to defeat the limit on the other. Both buckets are always incremented
 * together, and the request is allowed only when both are still within their allowance. Raw email
 * addresses and raw IP addresses are never retained -- only their HMAC-like digests over the
 * server-only RATE_LIMIT_HASH_KEY, matching this codebase's existing anonymous-recovery evidence
 * contract (lib/membership/account-recovery.ts). */
export async function checkRateLimit(purpose: string, email: string, origin: string, now: Date = new Date()): Promise<boolean> {
  const secret = rateLimitHashKeyForServer();
  const windowStartedAt = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const emailHash = digest(`${secret}:email:${email}`);
  const originHash = digest(`${secret}:origin:${origin || 'unknown'}`);
  const allOriginsMarker = digest(`${secret}:all-origins`);
  const allEmailsMarker = digest(`${secret}:all-emails`);
  const [emailAllowed, ipAllowed] = await Promise.all([
    takeBucket(purpose, emailHash, allOriginsMarker, windowStartedAt, EMAIL_MAX_REQUESTS),
    takeBucket(purpose, allEmailsMarker, originHash, windowStartedAt, IP_MAX_REQUESTS),
  ]);
  // AUTH-OPERATIONS-006: a single blocked request is routine and already fully handled by the
  // rejection above; only sustained blocking across multiple windows for the *same* bucket is
  // correlated into an operator alert -- see rate-limit-correlation.ts. Best-effort: never affects
  // the boolean this function returns.
  if (!emailAllowed) {
    await correlateRepeatedRateLimitExceedance({ identifierHash: emailHash, max: EMAIL_MAX_REQUESTS, now, originHash: allOriginsMarker, purpose });
  }
  if (!ipAllowed) {
    await correlateRepeatedRateLimitExceedance({ identifierHash: allEmailsMarker, max: IP_MAX_REQUESTS, now, originHash, purpose });
  }
  return emailAllowed && ipAllowed;
}

/** Protects server-side calls made with a shared third-party provider credential. The higher limits
 * are suitable for debounced interactive autocomplete while still bounding one account and one
 * request origin independently so neither can exhaust the shared provider quota unchecked. */
export async function checkProviderRateLimit(
  purpose: string,
  accountIdentifier: string,
  origin: string,
  now: Date = new Date(),
): Promise<boolean> {
  const secret = rateLimitHashKeyForServer();
  const windowStartedAt = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const accountHash = digest(`${secret}:provider-account:${accountIdentifier}`);
  const originHash = digest(`${secret}:provider-origin:${origin || 'unknown'}`);
  const allOriginsMarker = digest(`${secret}:all-origins`);
  const allAccountsMarker = digest(`${secret}:all-provider-accounts`);
  const [accountAllowed, originAllowed] = await Promise.all([
    takeBucket(purpose, accountHash, allOriginsMarker, windowStartedAt, PROVIDER_USER_MAX_REQUESTS),
    takeBucket(purpose, allAccountsMarker, originHash, windowStartedAt, PROVIDER_ORIGIN_MAX_REQUESTS),
  ]);
  return accountAllowed && originAllowed;
}

/** Authentication-adjacent endpoints without an email identifier (for example an OAuth start
 * route) use an origin-only bucket rather than inventing a shared email value that would create
 * one global limit for every user. */
export async function checkOriginRateLimit(purpose: string, origin: string, now: Date = new Date()): Promise<boolean> {
  const secret = rateLimitHashKeyForServer();
  const windowStartedAt = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const originHash = digest(`${secret}:origin:${origin || 'unknown'}`);
  const allEmailsMarker = digest(`${secret}:all-emails`);
  return takeBucket(purpose, allEmailsMarker, originHash, windowStartedAt, IP_MAX_REQUESTS);
}

/** The requesting client's IP, derived the same way on every auth-adjacent Server Action: the first
 * entry of X-Forwarded-For (Vercel's proxy chain), falling back to X-Real-IP, then 'unknown' -- see
 * resolveRequestOrigin (./request-origin.ts) for the trust/validation rules. */
export async function requestOrigin(): Promise<string> {
  const isolatedOrigin = testRequestOrigin();
  if (isolatedOrigin) return isolatedOrigin;
  const requestHeaders = await headers();
  return resolveRequestOrigin(requestHeaders.get('x-forwarded-for'), requestHeaders.get('x-real-ip'), Boolean(process.env.VERCEL));
}
