import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';

export class DirectoryRateLimitedError extends Error {
  constructor() {
    super('Too many directory searches. Please wait a few minutes and try again.');
    this.name = 'DirectoryRateLimitedError';
  }
}

// Fixed, server-controlled -- never a client-supplied value -- so a caller cannot request an
// arbitrarily large page to bulk-harvest the directory in one request.
export const DIRECTORY_PAGE_SIZE = 25;
// Bounds total reachable depth to DIRECTORY_MAX_PAGE * DIRECTORY_PAGE_SIZE (5,000) rows even for an
// unfiltered browse -- deep-offset scraping has a hard ceiling independent of how many members exist.
export const DIRECTORY_MAX_PAGE = 200;

export const MEMBERSHIP_TYPE_FILTERS = ['judge', 'steward', 'combo', 'veterinarian'] as const;
export type MembershipTypeFilter = typeof MEMBERSHIP_TYPE_FILTERS[number];

// Next.js searchParams values are string | string[] | undefined at runtime (a repeated query key
// like ?country=DE&country=FR becomes an array) regardless of a narrower page-level annotation, so
// every filter accepts that real shape and normalized() below explicitly resolves it rather than
// calling string methods on a value that might actually be an array.
type RawFilterValue = string | string[] | undefined;
export type MemberDirectoryFilters = {
  country?: RawFilterValue; federation?: RawFilterValue; membershipType?: RawFilterValue;
  page?: number | RawFilterValue; q?: RawFilterValue; region?: RawFilterValue; sort?: RawFilterValue;
};

export type DirectoryRoleDetail = { officialStatuses: string[] | null; roleType: string };

/** Deliberately excludes email, address, exact coordinates, and every internal/sequential
 * identifier (profile id, user id) -- see docs/05's paid-directory privacy requirement. Only the
 * fields the placeholder page at app/(marketing)/about/members-directory previously documented as
 * the eventual real directory's content (name, country, role, level), plus federation/region so the
 * documented filters have something to display alongside each result. */
export type DirectoryMemberRow = {
  country: string; federation: string | null; firstName: string;
  lastName: string; membershipType: MembershipTypeFilter | null; region: string | null; roles: DirectoryRoleDetail[] | null;
};

type RawDirectoryRow = {
  country: string; federation: string | null; firstName: string; lastName: string;
  membershipType: MembershipTypeFilter | null; region: string | null; roles: DirectoryRoleDetail[] | null;
};

// An array-valued (repeated-key) filter is treated as absent rather than guessing which value the
// caller meant -- see the RawFilterValue comment above.
function firstString(value: RawFilterValue): string | undefined {
  return Array.isArray(value) ? undefined : value;
}
function pageNumber(value: number | RawFilterValue): number {
  return Number(typeof value === 'number' ? value : firstString(value));
}

function normalized(input: MemberDirectoryFilters) {
  const page = pageNumber(input.page);
  const membershipType = firstString(input.membershipType);
  return {
    country: firstString(input.country)?.trim().toUpperCase().slice(0, 2) || undefined,
    federation: firstString(input.federation)?.trim().toUpperCase().slice(0, 2) || undefined,
    membershipType: membershipType && MEMBERSHIP_TYPE_FILTERS.includes(membershipType as MembershipTypeFilter) ? membershipType as MembershipTypeFilter : undefined,
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, DIRECTORY_MAX_PAGE) : 1,
    q: firstString(input.q)?.trim().slice(0, 100) || undefined,
    region: firstString(input.region)?.trim().slice(0, 40) || undefined,
    sort: ['country', 'region'].includes(firstString(input.sort) ?? '') ? firstString(input.sort) as 'country' | 'region' : 'name' as const,
  };
}

function queryParts(raw: MemberDirectoryFilters) {
  const filters = normalized(raw);
  const conditions = [
    // Scope to currently-entitled members only -- the same test as lib/membership/entitlement.ts's
    // isEntitled -- so the directory reflects current members, not every account ever created.
    sql`((m.status in ('active', 'complimentary', 'canceled') and m.valid_until >= current_date) or (m.status='grace' and coalesce(m.grace_ends_on,m.valid_until) >= current_date))`,
  ];
  if (filters.q) {
    const pattern = `%${filters.q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    conditions.push(sql`(p.first_name ilike ${pattern} escape '\\' or p.last_name ilike ${pattern} escape '\\' or concat_ws(' ', p.first_name, p.last_name) ilike ${pattern} escape '\\')`);
  }
  if (filters.country) conditions.push(sql`p.country_code = ${filters.country}`);
  if (filters.federation) conditions.push(sql`roles.federation = ${filters.federation}`);
  if (filters.region) conditions.push(sql`roles.region = ${filters.region}`);
  if (filters.membershipType) conditions.push(filters.membershipType === 'combo'
    ? sql`roles.has_judge and roles.has_steward`
    : sql`roles.role_types @> array[${filters.membershipType}]::text[]`);
  return { filters, where: sql.join(conditions, sql` and `) };
}

const from = sql`from idoc.profiles p
  join lateral (select status, valid_until, grace_ends_on from idoc.memberships where profile_id = p.id order by valid_until desc, id desc limit 1) m on true
  left join lateral (
    select array_agg(distinct role_type)::text[] role_types, bool_or(role_type = 'judge') has_judge, bool_or(role_type = 'steward') has_steward,
      min(national_federation_country_code) federation, min(idoc_region) region,
      jsonb_agg(jsonb_build_object('roleType', role_type, 'officialStatuses', official_statuses) order by role_type) role_details
    from idoc.professional_roles where profile_id = p.id and effective_to is null
  ) roles on true`;
// A stable order independent of insertion timing: name first, then the non-exposed internal id as a
// pure tiebreaker (never selected/returned) so pagination never skips or repeats a row across pages.
function directoryOrder(sort: 'country' | 'name' | 'region') {
  if (sort === 'country') return sql`p.country_code asc, p.last_name asc, p.first_name asc, p.id asc`;
  if (sort === 'region') return sql`roles.region asc nulls last, p.last_name asc, p.first_name asc, p.id asc`;
  return sql`p.last_name asc, p.first_name asc, p.id asc`;
}

/** Server-side searchable/filterable paid-member directory. Re-authorizes independently of any
 * caller (the same defense-in-depth convention as lib/membership/admin-memberships.ts) -- entitled
 * members and privileged administrators only, matching every other member-facing surface's
 * paid/grace/expired/suspended/unpaid access rule (mayAccessAccountFunction's 'member' operation). */
export async function listMemberDirectory(input: MemberDirectoryFilters = {}) {
  const actor = await requireAccountAccess('member');
  const allowed = await checkRateLimit('member_directory_search', String(actor.id), await requestOrigin());
  if (!allowed) throw new DirectoryRateLimitedError();
  const { filters, where } = queryParts(input);
  const order = directoryOrder(filters.sort);
  const offset = (filters.page - 1) * DIRECTORY_PAGE_SIZE;
  const [rows, counts] = await Promise.all([
    db.execute<RawDirectoryRow>(sql`select p.first_name "firstName", p.last_name "lastName", p.country_code country, roles.federation, roles.region,
      case when roles.has_judge and roles.has_steward then 'combo' when cardinality(roles.role_types) = 1 then roles.role_types[1] else null end "membershipType",
      roles.role_details "roles" ${from} where ${where} order by ${order} limit ${DIRECTORY_PAGE_SIZE} offset ${offset}`),
    db.execute<{ count: number }>(sql`select count(*)::int count ${from} where ${where}`),
  ]);
  return {
    filters, maxPage: DIRECTORY_MAX_PAGE, pageSize: DIRECTORY_PAGE_SIZE,
    rows: rows.map((row): DirectoryMemberRow => ({ ...row })),
    total: Math.min(counts[0]?.count ?? 0, DIRECTORY_MAX_PAGE * DIRECTORY_PAGE_SIZE),
  };
}
