import 'server-only';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { rateLimitHashKeyForServer } from '@/lib/runtime/configuration';

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_MAX_REQUESTS = 3;
const IP_MAX_REQUESTS = 10;

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
  return emailAllowed && ipAllowed;
}

/** The requesting client's IP, derived the same way on every auth-adjacent Server Action: the first
 * entry of X-Forwarded-For (Vercel's proxy chain), falling back to X-Real-IP, then 'unknown'. */
export async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  return requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? requestHeaders.get('x-real-ip') ?? 'unknown';
}
