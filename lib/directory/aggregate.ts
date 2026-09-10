import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { logError } from '@/lib/observability/logger';

/**
 * Minimum number of currently-entitled members a geographic area (country) must have before it is
 * ever rendered on the public map. Documented here as the single source of truth (docs/05 §"Public
 * directory/map privacy controls" restates this value, not a second one) -- an area with fewer
 * members than this is never displayed, has its member_count never returned, and is silently folded
 * out of the response entirely rather than merged into a visible "other" bucket, since a merged
 * bucket combined with a displayed grand total would let a reader back-calculate its size. For the
 * same reason this module deliberately never returns (and the page never displays) a total-members
 * figure alongside the thresholded per-area counts.
 */
export const DIRECTORY_MIN_AGGREGATION_THRESHOLD = 5;

export type ConcentrationArea = { countryCode: string; memberCount: number };
export type ConcentrationResult =
  | { areas: ConcentrationArea[]; ok: true; threshold: number }
  | { ok: false };

type ConcentrationRow = { country_code: string; member_count: number };

/**
 * Public, unauthenticated aggregate query for the member-concentration map. Deliberately selects
 * nothing but a country code and a thresholded count -- never a name, email, address, exact
 * coordinate, profile id, or any other field that could identify an individual or be combined with
 * another field to do so (docs/05's public-map privacy requirement). Scoped to currently-entitled
 * members only (the same active/grace/complimentary/canceled-with-unexpired-term test as
 * lib/membership/entitlement.ts's isEntitled), so the map reflects the current membership footprint,
 * not every account ever created. A query failure is caught and reported as an "unavailable" result
 * rather than propagating -- this is public, unauthenticated surface area, so a transient database
 * hiccup should degrade to a friendly message, not an opaque error page.
 */
export async function getPublicMemberConcentration(): Promise<ConcentrationResult> {
  try {
    const rows = await db.execute<ConcentrationRow>(sql`
      select p.country_code as country_code, count(*)::int as member_count
      from idoc.profiles p
      join lateral (
        select status, valid_until from idoc.memberships
        where profile_id = p.id order by valid_until desc, id desc limit 1
      ) m on true
      where ((m.status in ('active', 'complimentary', 'canceled') and m.valid_until >= current_date) or (m.status='grace' and coalesce(m.grace_ends_on,m.valid_until) >= current_date))
      group by p.country_code
      having count(*) >= ${DIRECTORY_MIN_AGGREGATION_THRESHOLD}
      order by count(*) desc, p.country_code asc
    `);
    return {
      areas: rows.map((row) => ({ countryCode: row.country_code, memberCount: row.member_count })),
      ok: true,
      threshold: DIRECTORY_MIN_AGGREGATION_THRESHOLD,
    };
  } catch {
    logError('directory_map_query_failed');
    return { ok: false };
  }
}
