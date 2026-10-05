import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { COUNTRY_OPTIONS } from '@/lib/membership/countries';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';

export class DirectoryRateLimitedError extends Error {
  constructor() {
    super('Too many directory searches. Please wait a few minutes and try again.');
    this.name = 'DirectoryRateLimitedError';
  }
}

export const DIRECTORY_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export const DIRECTORY_PAGE_SIZE = 25;
export const DIRECTORY_MAX_RESULTS = 5_000;

export const MEMBERSHIP_TYPE_FILTERS = ['judge', 'steward', 'combo', 'veterinarian'] as const;
export type MembershipTypeFilter = typeof MEMBERSHIP_TYPE_FILTERS[number];
const VALID_FEDERATIONS = new Set(COUNTRY_OPTIONS.map(({ code }) => code));
const SORT_COLUMNS = ['name', 'email', 'type', 'federation', 'region'] as const;
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
  email: string; federation: string | null; firstName: string;
  lastName: string; membershipType: MembershipTypeFilter | null; region: string | null; roles: DirectoryRoleDetail[] | null;
};
type RawDirectoryRow = DirectoryMemberRow;

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
  if (!raw) return [{ id: 'name', desc: false }];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [{ id: 'name', desc: false }];
    const result = parsed.flatMap((entry): DirectorySort[] => {
      if (!entry || typeof entry !== 'object') return [];
      const { id, desc } = entry as { id?: unknown; desc?: unknown };
      return typeof id === 'string' && SORT_COLUMNS.includes(id as SortColumn) && typeof desc === 'boolean'
        ? [{ id: id as SortColumn, desc }]
        : [];
    }).slice(0, SORT_COLUMNS.length);
    return result.length ? result : [{ id: 'name', desc: false }];
  } catch {
    return [{ id: 'name', desc: false }];
  }
}
function normalized(input: MemberDirectoryFilters) {
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

function queryParts(raw: MemberDirectoryFilters) {
  const filters = normalized(raw);
  const conditions = [
    sql`((m.status in ('active', 'complimentary', 'canceled') and m.valid_until >= current_date) or (m.status='grace' and coalesce(m.grace_ends_on,m.valid_until) >= current_date))`,
  ];
  if (filters.q) {
    const pattern = `%${filters.q.replaceAll('%', '\\\\%').replaceAll('_', '\\\\_')}%`;
    conditions.push(sql`(p.first_name ilike ${pattern} escape '\\\\' or p.last_name ilike ${pattern} escape '\\\\' or concat_ws(' ', p.first_name, p.last_name) ilike ${pattern} escape '\\\\' or coalesce(u.email_display, u.email) ilike ${pattern} escape '\\\\')`);
  }
  if (filters.federation.length) conditions.push(sql`roles.federation = any(${filters.federation})`);
  if (filters.region.length) conditions.push(sql`roles.region = any(${filters.region})`);
  if (filters.membershipType.length) {
    conditions.push(sql.join(filters.membershipType.map((type) => type === 'combo'
      ? sql`(roles.has_judge and roles.has_steward)`
      : sql`roles.role_types @> array[${type}]::text[]`), sql` or `));
  }
  return { filters, where: sql.join(conditions, sql` and `) };
}

const from = sql`from idoc.profiles p
  join idoc.users u on u.id = p.user_id and u.deleted_at is null and u.account_state = 'active'
  and not exists (select 1 from idoc.application_roles ar where ar.user_id = u.id and ar.revoked_at is null and ar.role in ('administrator', 'super_admin'))
  join lateral (select status, valid_until, grace_ends_on from idoc.memberships where profile_id = p.id order by valid_until desc, id desc limit 1) m on true
  left join lateral (
    select array_agg(distinct role_type)::text[] role_types, bool_or(role_type = 'judge') has_judge, bool_or(role_type = 'steward') has_steward,
      min(national_federation_country_code) federation, min(idoc_region) region,
      jsonb_agg(jsonb_build_object('roleType', role_type, 'officialStatuses', official_statuses) order by role_type) role_details
    from idoc.professional_roles where profile_id = p.id and effective_to is null
  ) roles on true`;

function directoryOrder(sorting: DirectorySort[]) {
  const expressions = sorting.map(({ id, desc }) => {
    const column = id === 'name' ? sql`p.last_name`
      : id === 'email' ? sql`coalesce(u.email_display, u.email)`
      : id === 'type' ? sql`roles.role_types[1]`
      : id === 'federation' ? sql`roles.federation`
      : sql`roles.region`;
    return sql`${column} ${desc ? sql`desc` : sql`asc`} nulls last`;
  });
  expressions.push(sql`p.last_name asc nulls last`, sql`p.first_name asc nulls last`, sql`p.id asc`);
  return sql.join(expressions, sql`, `);
}

/** Server-side searchable/filterable directory. Re-authorizes every read and returns only active,
 * non-archived, non-administrator member records. */
export async function listMemberDirectory(input: MemberDirectoryFilters = {}) {
  const actor = await requireAccountAccess('member');
  const allowed = await checkRateLimit('member_directory_search', String(actor.id), await requestOrigin());
  if (!allowed) throw new DirectoryRateLimitedError();
  const { filters, where } = queryParts(input);
  const order = directoryOrder(filters.sort);
  const offset = (filters.page - 1) * filters.pageSize;
  const [rows, counts] = await Promise.all([
    db.execute<RawDirectoryRow>(sql`select p.first_name "firstName", p.last_name "lastName", coalesce(u.email_display, u.email) email, roles.federation, roles.region,
      case when roles.has_judge and roles.has_steward then 'combo' when cardinality(roles.role_types) = 1 then roles.role_types[1] else null end "membershipType",
      roles.role_details "roles" ${from} where ${where} order by ${order} limit ${filters.pageSize} offset ${offset}`),
    db.execute<{ count: number }>(sql`select count(*)::int count ${from} where ${where}`),
  ]);
  return {
    filters, maxPage: Math.max(1, Math.ceil(DIRECTORY_MAX_RESULTS / filters.pageSize)),
    pageSize: filters.pageSize,
    rows: rows.map((row): DirectoryMemberRow => ({ ...row })),
    total: Math.min(counts[0]?.count ?? 0, DIRECTORY_MAX_RESULTS),
  };
}
