import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { COUNTRY_OPTIONS } from '@/lib/membership/countries';
import { dailyCache } from '@/lib/cache/daily-cache';
import { directoryQueryGate } from '@/lib/directory/query-gate';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';

export { DirectoryBusyError } from '@/lib/directory/query-gate';

export class DirectoryRateLimitedError extends Error {
  constructor() {
    super('Too many directory searches. Please wait a few minutes and try again.');
    this.name = 'DirectoryRateLimitedError';
  }
}

export const DIRECTORY_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DIRECTORY_PAGE_SIZE = 25;
export const DIRECTORY_MAX_RESULTS = 5_000;
export const DIRECTORY_MAX_PAGE = DIRECTORY_MAX_RESULTS / DIRECTORY_PAGE_SIZE;

export const MEMBERSHIP_TYPE_FILTERS = ['judge', 'steward', 'combo', 'veterinarian'] as const;
export type MembershipTypeFilter = typeof MEMBERSHIP_TYPE_FILTERS[number];
const VALID_FEDERATIONS = new Set(COUNTRY_OPTIONS.map(({ code }) => code));
const SORT_COLUMNS = ['name', 'firstName', 'lastName', 'email', 'type', 'region', 'federation'] as const;
type SortColumn = typeof SORT_COLUMNS[number];
export type DirectorySort = { id: SortColumn; desc: boolean };

type RawFilterValue = string | string[] | undefined;
export type MemberDirectoryFilters = {
  federation?: RawFilterValue; membershipType?: RawFilterValue;
  page?: number | RawFilterValue; pageSize?: number | RawFilterValue;
  q?: RawFilterValue; region?: RawFilterValue; sort?: RawFilterValue;
};

export type DirectoryRoleDetail = { officialStatuses: string[] | null; roleType: string };
export type DirectoryMemberRow = {
  /** Null unless the member opted in to showing their email in the directory (default: not shown). */
  email: string | null; federation: string | null; firstName: string;
  lastName: string; membershipType: MembershipTypeFilter | null; region: string | null; roles: DirectoryRoleDetail[] | null;
};
type RawDirectoryRow = DirectoryMemberRow & { profileId: number };

function values(value: RawFilterValue, limit: number): string[] {
  const raw = Array.isArray(value) ? value : value?.split(',') ?? [];
  return [...new Set(raw.flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).filter(Boolean))].slice(0, limit);
}
function pageNumber(value: number | RawFilterValue, fallback: number): number {
  const raw = Array.isArray(value) ? undefined : value;
  const parsed = Number(typeof raw === 'number' ? raw : raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function parseSort(value: RawFilterValue): DirectorySort[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [{ id: 'lastName', desc: false }];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [{ id: 'lastName', desc: false }];
    const result = parsed.flatMap((entry): DirectorySort[] => {
      if (!entry || typeof entry !== 'object') return [];
      const { id, desc } = entry as { id?: unknown; desc?: unknown };
      return typeof id === 'string' && SORT_COLUMNS.includes(id as SortColumn) && typeof desc === 'boolean'
        ? [{ id: id as SortColumn, desc }]
        : [];
    }).slice(0, SORT_COLUMNS.length);
    return result.length ? result : [{ id: 'lastName', desc: false }];
  } catch {
    return [{ id: 'lastName', desc: false }];
  }
}
export function normalizeDirectoryFilters(input: MemberDirectoryFilters) {
  const pageSizeInput = pageNumber(input.pageSize, DIRECTORY_PAGE_SIZE);
  const pageSize = DIRECTORY_PAGE_SIZE_OPTIONS.includes(pageSizeInput as typeof DIRECTORY_PAGE_SIZE_OPTIONS[number])
    ? pageSizeInput : DIRECTORY_PAGE_SIZE;
  const federation = values(input.federation, 250).filter((code) => VALID_FEDERATIONS.has(code.toUpperCase())).map((code) => code.toUpperCase());
  const membershipType = values(input.membershipType, MEMBERSHIP_TYPE_FILTERS.length).filter((type): type is MembershipTypeFilter => MEMBERSHIP_TYPE_FILTERS.includes(type as MembershipTypeFilter));
  const region = values(input.region, 20).filter((item) => item.length <= 40);
  const page = pageNumber(input.page, 1);
  return {
    federation, membershipType,
    page: Math.min(page, Math.max(1, Math.ceil(DIRECTORY_MAX_RESULTS / pageSize))),
    pageSize,
    q: (Array.isArray(input.q) ? undefined : input.q)?.trim().slice(0, 100) || undefined,
    region,
    sort: parseSort(input.sort),
  };
}

/** A member's National Federation as the public map counts it (docs/05): their recorded federation,
 * falling back to their address country only when none is recorded. The directory's federation
 * column, filter and sort use the same rule, so clicking a country on the map lists exactly the
 * members that country's dot counts. */
const federationExpression = sql`coalesce(roles.federation, nullif(p.country_code, ''))`;

/** Whether a member's current membership lists them in the directory at all. Shared by the
 * (cacheable) listing query and the live per-page check, so both always apply the same rule. */
const eligibleCondition = sql`m.status <> 'archived' and ((m.status in ('active', 'complimentary', 'canceled') and m.valid_until >= current_date) or (m.status='grace' and coalesce(m.grace_ends_on,m.valid_until) >= current_date))`;

function queryParts(raw: MemberDirectoryFilters) {
  const filters = normalizeDirectoryFilters(raw);
  const conditions = [eligibleCondition];
  if (filters.q) {
    const pattern = `%${filters.q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    // One indexable arm per searched field (each matches a trigram index from migration 0081), combined
    // with a union: an `or` across profiles and users could not use any index. The expressions must stay
    // identical to the indexed ones. The email arm only matches members who opted in to showing it.
    conditions.push(sql`p.id in (
      select id from profiles where first_name ilike ${pattern} escape '\\'
      union select id from profiles where last_name ilike ${pattern} escape '\\'
      union select id from profiles where (first_name || ' ' || last_name) ilike ${pattern} escape '\\'
      union select sp.id from profiles sp join users su on su.id = sp.user_id
        where sp.directory_email_opt_in and coalesce(su.email_display, su.email) ilike ${pattern} escape '\\')`);
  }
  if (filters.federation.length) conditions.push(sql`${federationExpression} in (${sql.join(filters.federation.map((code) => sql`${code}`), sql`, `)})`);
  if (filters.region.length) conditions.push(sql`roles.region in (${sql.join(filters.region.map((region) => sql`${region}`), sql`, `)})`);
  if (filters.membershipType.length) {
    conditions.push(sql`(${sql.join(filters.membershipType.map((type) => type === 'combo'
      ? sql`(roles.has_judge and roles.has_steward)`
      : sql`roles.role_types @> array[${type}]::text[]`), sql` or `)})`);
  }
  return { filters, where: sql.join(conditions, sql` and `) };
}

// Imported legacy members whose account is still `migrated_pending` (not yet activated) are listed like
// any other current member: appearing here is not consent-gated. Only the email (shown as a mailto
// link) is, and both come from `directory_email_opt_in` (default off) in the select below.
const from = sql`from profiles p
  join users u on u.id = p.user_id and u.deleted_at is null and u.account_state in ('active', 'migrated_pending')
  and not exists (select 1 from application_roles ar where ar.user_id = u.id and ar.revoked_at is null and ar.role = 'super_admin')
  join lateral (select status, valid_until, grace_ends_on from memberships where profile_id = p.id order by valid_until desc, id desc limit 1) m on true
  left join lateral (
    select array_agg(distinct role_type)::text[] role_types, bool_or(role_type = 'judge') has_judge, bool_or(role_type = 'steward') has_steward,
      min(national_federation_country_code) federation, min(idoc_region) region,
      case when bool_or(role_type = 'judge') and bool_or(role_type = 'steward') then 'combo' when count(distinct role_type) = 1 then min(role_type) else null end membership_type,
      jsonb_agg(jsonb_build_object('roleType', role_type, 'officialStatuses', official_statuses) order by role_type) role_details
    from professional_roles where profile_id = p.id and effective_to is null
  ) roles on true`;

function directoryOrder(sorting: DirectorySort[]) {
  const expressions = sorting.flatMap(({ id, desc }) => {
    const direction = desc ? sql`desc` : sql`asc`;
    const column = id === 'name' || id === 'lastName' ? sql`p.last_name`
      : id === 'firstName' ? sql`p.first_name`
      : id === 'email' ? sql`case when p.directory_email_opt_in then coalesce(u.email_display, u.email) end`
      : id === 'type' ? sql`roles.membership_type`
      : id === 'federation' ? federationExpression
      : sql`roles.region`;
    return [
      sql`${column} ${direction} nulls last`,
      ...(id === 'name' || id === 'lastName' ? [sql`p.first_name ${direction} nulls last`] : []),
    ];
  });
  expressions.push(sql`p.last_name asc nulls last`, sql`p.first_name asc nulls last`, sql`p.id asc`);
  return sql.join(expressions, sql`, `);
}

type DirectoryQueryInput = {
  federation: string[]; membershipType: string[]; page: number; pageSize: number;
  q?: string; region: string[]; sort: string;
};

/** The cacheable part of a listing: one page of rows (ordering, names, federation, region, role
 * details) and the total, for a set of filters. It deliberately carries NO email and no live
 * eligibility: those are privacy-sensitive and are always read live in `liveDirectoryDetails`, so a
 * member withdrawing their email opt-in, being deleted, suspended or granted Super Admin access takes
 * effect immediately even when this result is up to a day old. It throws on failure, so a failure
 * is never cached. */
async function runDirectoryQuery(input: DirectoryQueryInput) {
  const { filters, where } = queryParts(input);
  const order = directoryOrder(filters.sort);
  const offset = (filters.page - 1) * filters.pageSize;
  // Only a cache miss or an uncached search reaches here, so cache hits never wait for a slot.
  const [rows, counts] = await directoryQueryGate.run(() => Promise.all([
    db.execute<RawDirectoryRow>(sql`select p.id "profileId", p.first_name "firstName", p.last_name "lastName", null::text email, ${federationExpression} federation, roles.region,
      case when roles.has_judge and roles.has_steward then 'combo' when cardinality(roles.role_types) = 1 then roles.role_types[1] else null end "membershipType",
      roles.role_details "roles" ${from} where ${where} order by ${order} limit ${filters.pageSize} offset ${offset}`),
    db.execute<{ count: number }>(sql`select count(*)::int count ${from} where ${where}`),
  ]));
  return {
    rows: rows.map((row): RawDirectoryRow => ({ ...row })),
    total: Math.min(counts[0]?.count ?? 0, DIRECTORY_MAX_RESULTS),
  };
}

/** Always-live, per-request check of the members on one page: are they still listed (membership,
 * account state, not a Super Admin) and, only if they opted in, what is their email. */
async function liveDirectoryDetails(profileIds: number[]): Promise<Map<number, string | null>> {
  if (profileIds.length === 0) return new Map();
  const rows = await db.execute<{ profileId: number; email: string | null }>(sql`
    select p.id "profileId", case when p.directory_email_opt_in then coalesce(u.email_display, u.email) end email
    ${from} where ${eligibleCondition} and p.id in (${sql.join(profileIds.map((id) => sql`${id}`), sql`, `)})`);
  return new Map(rows.map((row) => [row.profileId, row.email]));
}

// The page structure is renewed at most once a day per distinct set of filters. Access control, rate
// limiting and the live per-page check stay outside the cache and run on every request.
const cachedDirectoryQuery = dailyCache(runDirectoryQuery, ['member-directory-query-admin-visible-v2']);

/** Server-side searchable/filterable directory. Re-authorizes every read and returns only active,
 * non-archived member records (excluding Super Admins). The page structure is cached for a day per set of
 * filters; email and eligibility are always live. A text search or an email sort is never cached,
 * because it can match or order by an email address whose owner has since withdrawn their opt-in. */
export async function listMemberDirectory(input: MemberDirectoryFilters = {}) {
  const actor = await requireAccountAccess('member');
  const allowed = await checkRateLimit('member_directory_search', String(actor.id), await requestOrigin());
  if (!allowed) throw new DirectoryRateLimitedError();
  const filters = normalizeDirectoryFilters(input);
  const query = { ...filters, sort: JSON.stringify(filters.sort) };
  const cacheable = !filters.q && !filters.sort.some(({ id }) => id === 'email');
  const { rows, total } = await (cacheable ? cachedDirectoryQuery : runDirectoryQuery)(query);
  const live = await liveDirectoryDetails(rows.map((row) => row.profileId));
  return {
    filters, maxPage: Math.max(1, Math.ceil(DIRECTORY_MAX_RESULTS / filters.pageSize)),
    pageSize: filters.pageSize,
    // Drop anyone no longer listed; never expose the internal profile id.
    rows: rows.flatMap(({ profileId, ...row }): DirectoryMemberRow[] => live.has(profileId) ? [{ ...row, email: live.get(profileId) ?? null }] : []),
    total,
  };
}
