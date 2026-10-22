import 'server-only';

import { cache } from 'react';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { classifySessionGate, type SessionGate } from './session-gate';

export type LatestMembershipFacts = { graceEndsOn: string | null; status: string; validUntil: string };
export type AccountFacts = { accountState: string; latestMembership: LatestMembershipFacts | null; roles: string[] };

/** The account facts every authorization decision reads -- account state, active role grants and the latest membership -- in ONE
 * statement. Each caller used to issue the same users, roles, profile and memberships reads as three sequential round trips, and a
 * single signed-in page view repeated them in middleware, the layouts and the page. Memoized per server render (React cache), so
 * the middleware gate, authenticatedActor() and the header's entitlement check all share one read; outside a render (Server
 * Actions, Route Handlers, middleware, tests) every call reads the database afresh. Returns null when the user row does not exist. */
export const loadAccountFacts = cache(async function loadAccountFacts(userId: number): Promise<AccountFacts | null> {
  const rows = await db.execute<{
    accountState: string; graceEndsOn: string | null; membershipStatus: string | null; roles: string[]; validUntil: string | null;
  }>(sql`
    select u.account_state as "accountState",
      coalesce((select array_agg(ar.role)::text[] from application_roles ar where ar.user_id = u.id and ar.revoked_at is null), '{}'::text[]) as "roles",
      m.status as "membershipStatus", m.valid_until as "validUntil", m.grace_ends_on as "graceEndsOn"
    from users u
    left join profiles p on p.user_id = u.id
    left join lateral (
      select status, valid_until, grace_ends_on from memberships where profile_id = p.id order by valid_until desc, id desc limit 1
    ) m on true
    where u.id = ${userId}
    limit 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    accountState: row.accountState,
    latestMembership: row.membershipStatus !== null && row.validUntil !== null
      ? { graceEndsOn: row.graceEndsOn, status: row.membershipStatus, validUntil: row.validUntil }
      : null,
    roles: Array.isArray(row.roles) ? [...row.roles] : [],
  };
});

/** Reads the same facts authenticatedActor (data-access.ts) uses -- account state, active role
 * grants, and the latest membership -- and classifies them. One place decides who may see what, so
 * sign-in, Google sign-in and the per-request gate in middleware cannot drift apart. */
export async function loadSessionGate(userId: number, today: string = new Date().toISOString().slice(0, 10)): Promise<{ accountState: string; gate: SessionGate }> {
  const facts = await loadAccountFacts(userId);
  if (!facts) return { accountState: 'unknown', gate: 'open' };
  const privileged = facts.roles.some((role) => role === 'administrator' || role === 'super_admin');
  return {
    accountState: facts.accountState,
    gate: classifySessionGate({ accountState: facts.accountState, membership: facts.latestMembership, privileged, today }),
  };
}
