import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { logError } from '@/lib/observability/logger';
import { ISO_COUNTRY_CODES } from '@/lib/membership/validation';

/**
 * Minimum number of currently-entitled members a country must have before it is rendered on the
 * public map. The owner decided (October 2026) that there is no minimum: a country with a single
 * member is shown, so the constant is 1 and the `having` clause below is a no-op that stays only so
 * the threshold remains a single documented, tested knob (docs/05 restates this value, not a second
 * one). Raising it again is a privacy-sensitive change under docs/05 and docs/07. The module still
 * never returns a total-members figure and never merges areas into an "other" bucket.
 */
export const DIRECTORY_MIN_AGGREGATION_THRESHOLD = 1;

export type ConcentrationArea = { countryCode: string; memberCount: number };
export type ConcentrationResult =
  | { areas: ConcentrationArea[]; ok: true; threshold: number }
  | { ok: false };

type ConcentrationRow = { country_code: string; member_count: number };

/**
 * Public, unauthenticated aggregate query for the member-concentration map. Deliberately selects
 * nothing but a country code and a count -- never a name, email, address, exact
 * coordinate, profile id, or any other field that could identify an individual or be combined with
 * another field to do so (docs/05's public-map privacy requirement). Scoped to currently-entitled
 * members only (the same active/grace/complimentary/canceled-with-unexpired-term test as
 * lib/membership/entitlement.ts's isEntitled), so the map reflects the current membership footprint,
 * not every account ever created. A query failure is caught and reported as an "unavailable" result
 * rather than propagating -- this is public, unauthenticated surface area, so a transient database
 * hiccup should degrade to a friendly message, not an opaque error page. Profiles whose country is blank
 * or not a canonical ISO 3166-1 code (legacy imports can leave it empty or malformed) are excluded, since they cannot be named
 * or placed on the map and would otherwise form their own group.
 */
export async function getPublicMemberConcentration(): Promise<ConcentrationResult> {
  try {
    const rows = await db.execute<ConcentrationRow>(sql`
      select c.country_code as country_code, count(*)::int as member_count
      from profiles p
      join lateral (
        select status, valid_until, grace_ends_on from memberships
        where profile_id = p.id order by valid_until desc, id desc limit 1
      ) m on true
      cross join lateral (
        select coalesce(
          (select min(r.national_federation_country_code) from professional_roles r where r.profile_id = p.id and r.national_federation_country_code is not null),
          nullif(p.country_code, '')
        ) as country_code
      ) c
      where c.country_code in (${sql.join(ISO_COUNTRY_CODES.map((code) => sql`${code}`), sql`, `)})
        and ((m.status in ('active', 'complimentary', 'canceled') and m.valid_until >= current_date) or (m.status='grace' and coalesce(m.grace_ends_on,m.valid_until) >= current_date))
      group by c.country_code
      having count(*) >= ${DIRECTORY_MIN_AGGREGATION_THRESHOLD}
      order by count(*) desc, c.country_code asc
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
