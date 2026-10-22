import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ISO_COUNTRY_CODES, IDOC_REGIONS, JUDGE_STATUSES, STEWARD_STATUSES } from '@/lib/membership/validation';
import { db } from '@/lib/db/drizzle';
import { auditLog } from '@/lib/db/schema';
import { requireAdministrator } from './authorization';
import { requireAccountAccess } from './data-access';

export const DEFAULT_ADMIN_MEMBER_PAGE_SIZE = 25;
export const MEMBER_EXPORT_LIMIT = 25_000;
export const MEMBERSHIP_STATUSES = ['active', 'expired', 'archived', 'without_active', 'board_member', 'administrator', 'super_admin', 'onboarding', 'test'] as const;
// Official Status filter tokens cover every judge and steward status; "Other" exists in both lists, so
// each token carries its role (`judge:<status>` / `steward:<status>`) to stay unambiguous.
export const OFFICIAL_STATUS_OPTIONS = [
  ...JUDGE_STATUSES.map((status) => ({ label: `Judge: ${status}`, value: `judge:${status}` })),
  ...STEWARD_STATUSES.map((status) => ({ label: `Steward: ${status}`, value: `steward:${status}` })),
] as const;
export const OFFICIAL_STATUS_VALUES: readonly string[] = OFFICIAL_STATUS_OPTIONS.map((option) => option.value);
export type MembershipStatusFilter = typeof MEMBERSHIP_STATUSES[number];
// Next.js searchParams values are string | string[] | undefined at runtime (a repeated query key
// becomes an array) regardless of a narrower page-level annotation, so every filter accepts that
// real shape; normalized() below resolves an array to its first value (matching the convention
// already used by lib/news/articles.ts, lib/seminars/seminars.ts, and lib/support/inbox.ts) before
// calling any string method on it.
type RawFilterValue = string | string[] | undefined;
export type MemberFilters = {
  column?: RawFilterValue; expiresFrom?: RawFilterValue; expiresTo?: RawFilterValue; federation?: RawFilterValue;
  membershipType?: RawFilterValue; officialStatus?: RawFilterValue; page?: number | RawFilterValue; pageSize?: number | RawFilterValue;
  direction?: RawFilterValue; filters?: RawFilterValue; q?: RawFilterValue; region?: RawFilterValue; sort?: RawFilterValue;
  status?: RawFilterValue; joinOperator?: RawFilterValue;
  // The membership-type column keeps id `type` (its sort id, matching SORT_FIELDS); the simple-mode
  // toolbar filter therefore syncs to a `type` query param rather than `membershipType`.
  type?: RawFilterValue;
};

export type AdminMemberRow = {
  country: string | null; email: string; federation: string | null; firstName: string | null;
  hasSupportHistory: boolean; isAdministrator: boolean; isBoardMember: boolean; isSuperAdmin: boolean; lastName: string | null; lastPaymentAt: Date | null; membershipType: string | null; profileId: number | null; region: string | null;
  officialStatuses: string[] | null; status: string; updatedAt: Date; userId: number; validUntil: string | null;
};

const SORT_FIELDS = ['name', 'email', 'status', 'type', 'federation', 'country', 'region', 'expires', 'lastPayment', 'updated'] as const;
type SortField = typeof SORT_FIELDS[number];
type AdvancedMemberFilter = { id: 'status' | 'type' | 'federation' | 'region' | 'expires'; operator: string; value: string | string[] };
export const MEMBERSHIP_TYPE_OPTIONS = ['judge', 'steward', 'combo', 'veterinarian'] as const;
type MembershipTypeOption = typeof MEMBERSHIP_TYPE_OPTIONS[number];

export class MemberFilterRangeError extends Error {
  constructor() {
    super('Choose valid expiration dates with the start date on or before the end date.');
    this.name = 'MemberFilterRangeError';
  }
}

// A scalar filter (q, sort, page, ...) resolves an array-valued (repeated-key) value to its first
// entry rather than crashing -- matching the convention already used by lib/news/articles.ts,
// lib/seminars/seminars.ts, and lib/support/inbox.ts -- so a string method is never called directly
// on an array.
function firstValue(value: RawFilterValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
function pageNumber(value: number | RawFilterValue): number {
  return Number(typeof value === 'number' ? value : firstValue(value));
}
// A multi-select filter (status, type, federation, region) can arrive two ways: a real
// repeated-key array from a raw request (?status=active&status=expired), or the single comma-joined
// query param the admin toolbar's multi-select actually sends (?status=active,expired). Both mean
// "match any of these", so both collapse to the same deduped token list here.
function allValues(value: RawFilterValue): string[] {
  const items = Array.isArray(value) ? value : value !== undefined ? [value] : [];
  return [...new Set(items.flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean))];
}

type NormalizedMemberFilters = {
  officialStatuses: string[]; expiresFrom?: string; expiresTo?: string; federations: string[];
  direction: 'asc' | 'desc'; membershipTypes: MembershipTypeOption[]; page: number; pageSize: 10 | 25 | 50 | 100; q?: string; regions: string[];
  sort: SortField; sorts: { id: SortField; desc: boolean }[]; advancedFilters: AdvancedMemberFilter[];
  joinOperator: 'and' | 'or'; statuses: MembershipStatusFilter[];
};

function normalized(input: MemberFilters): NormalizedMemberFilters {
  const page = pageNumber(input.page);
  const membershipTypes = [...allValues(input.membershipType), ...allValues(input.type)]
    .filter((value): value is MembershipTypeOption => MEMBERSHIP_TYPE_OPTIONS.includes(value as MembershipTypeOption));
  const rawSort = firstValue(input.sort);
  let parsedSort: { desc?: boolean; id?: string } | undefined;
  let sorts: { id: SortField; desc: boolean }[] = [];
  try {
    const parsed: unknown = rawSort?.startsWith('[') ? JSON.parse(rawSort) : null;
    if (Array.isArray(parsed)) sorts = parsed.filter((item): item is { id: SortField; desc: boolean } =>
      item && typeof item.id === 'string' && SORT_FIELDS.includes(item.id as SortField) && typeof item.desc === 'boolean').slice(0, SORT_FIELDS.length);
    parsedSort = sorts[0];
  } catch { parsedSort = undefined; }
  const legacySort = parsedSort?.id ?? rawSort;
  const [legacyField, legacyDirection] = legacySort?.split('_') ?? [];
  const sort = legacyField && SORT_FIELDS.includes(legacyField as SortField) ? legacyField : legacySort;
  const statuses = allValues(input.status).filter((value): value is MembershipStatusFilter => MEMBERSHIP_STATUSES.includes(value as MembershipStatusFilter));
  const rawPageSize = pageNumber(input.pageSize);
  const filters: NormalizedMemberFilters = {
    direction: parsedSort?.desc === true ? 'desc' : parsedSort?.desc === false ? 'asc' : firstValue(input.direction) === 'desc' || legacyDirection === 'desc' ? 'desc' : 'asc',
    expiresFrom: firstValue(input.expiresFrom) || undefined,
    expiresTo: firstValue(input.expiresTo) || undefined,
    officialStatuses: allValues(input.officialStatus).filter((value) => OFFICIAL_STATUS_VALUES.includes(value)),
    federations: allValues(input.federation).map((value) => value.trim().toUpperCase()).filter(Boolean),
    membershipTypes,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 25, 50, 100].includes(rawPageSize) ? rawPageSize as 10 | 25 | 50 | 100 : DEFAULT_ADMIN_MEMBER_PAGE_SIZE,
    q: firstValue(input.q)?.trim().slice(0, 200) || undefined,
    regions: allValues(input.region).map((value) => value.trim().slice(0, 40)).filter(Boolean),
    sort: sort && SORT_FIELDS.includes(sort as SortField) ? sort as SortField : 'name',
    sorts, advancedFilters: [], joinOperator: firstValue(input.joinOperator) === 'or' ? 'or' : 'and',
    // An empty selection means "no status restriction" here, exactly like every other facet below
    // (federations/regions/membershipTypes) -- it does NOT fall back to a default. The
    // "active by default" behavior a brand-new administrator sees is applied once, by the caller,
    // only when no preference has ever been saved (see app/(dashboard)/admin/members/page.tsx);
    // baking that default in here as well made Reset unable to distinguish "never customized" from
    // "explicitly cleared", so clearing the Status filter silently kept filtering to active members.
    statuses,
  };
  const rawAdvancedFilters = firstValue(input.filters);
  if (rawAdvancedFilters && rawAdvancedFilters.length <= 4000) {
    try {
      const advanced: unknown = JSON.parse(rawAdvancedFilters);
      if (Array.isArray(advanced)) filters.advancedFilters = advanced.slice(0, 20).filter((filter): filter is AdvancedMemberFilter =>
        filter && ['status', 'type', 'federation', 'region', 'expires'].includes(filter.id)
        && typeof filter.operator === 'string' && (typeof filter.value === 'string'
          || Array.isArray(filter.value) && filter.value.every((value: unknown) => typeof value === 'string')));
    } catch { /* Invalid advanced state is ignored and server defaults remain authoritative. */ }
  }
  const validDate = (value: string | undefined) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!validDate(filters.expiresFrom) || !validDate(filters.expiresTo)
    || (filters.expiresFrom && filters.expiresTo && filters.expiresFrom > filters.expiresTo)) throw new MemberFilterRangeError();
  return filters;
}

function statusCondition(value: MembershipStatusFilter, effectiveStatus: SQL): SQL {
  if (value === 'board_member') return sql`coalesce(p.is_board_member,false)`;
  if (value === 'administrator') return sql`coalesce(app_roles.is_administrator,false)`;
  if (value === 'super_admin') return sql`coalesce(app_roles.is_super_admin,false)`;
  if (value === 'onboarding') return sql`u.account_state in ('unverified','onboarding','migrated_pending')`;
  if (value === 'test') return sql`(u.email like '%+test@%' or u.email like '%@example.test' or u.email like '%@example.com')`;
  if (value === 'without_active') return sql`${effectiveStatus} <> 'active'`;
  return sql`${effectiveStatus} = ${value}`;
}

function advancedCondition(filter: AdvancedMemberFilter, effectiveStatus: SQL): SQL | null {
  const values = (Array.isArray(filter.value) ? filter.value : [filter.value]).filter(Boolean).slice(0, 20);
  if (filter.id === 'expires') {
    const field = sql`m.valid_until`;
    if (filter.operator === 'isEmpty') return sql`${field} is null`;
    if (filter.operator === 'isNotEmpty') return sql`${field} is not null`;
    const dates = values.map((value) => {
      if (!/^\d+$/.test(value)) return value;
      const date = new Date(Number(value));
      return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
    });
    if (!dates[0] || !/^\d{4}-\d{2}-\d{2}$/.test(dates[0])) return null;
    if (filter.operator === 'isBetween') return dates[1] && /^\d{4}-\d{2}-\d{2}$/.test(dates[1]) ? sql`${field} between ${dates[0]} and ${dates[1]}` : null;
    if (filter.operator === 'eq') return sql`${field} = ${dates[0]}`;
    if (filter.operator === 'ne') return sql`${field} is not null and ${field} <> ${dates[0]}`;
    if (filter.operator === 'gt') return sql`${field} > ${dates[0]}`;
    if (filter.operator === 'gte') return sql`${field} >= ${dates[0]}`;
    if (filter.operator === 'lt') return sql`${field} < ${dates[0]}`;
    if (filter.operator === 'lte') return sql`${field} <= ${dates[0]}`;
    return null;
  }
  const allowed = filter.id === 'status' ? MEMBERSHIP_STATUSES : filter.id === 'type' ? MEMBERSHIP_TYPE_OPTIONS
    : filter.id === 'region' ? IDOC_REGIONS : ISO_COUNTRY_CODES;
  const selected = [...new Set(values.filter((value) => (allowed as readonly string[]).includes(value)))];
  if (!selected.length || !['eq', 'ne', 'inArray', 'notInArray'].includes(filter.operator)) return null;
  const field = filter.id === 'type' ? sql`roles.membership_type` : filter.id === 'federation' ? sql`roles.federation` : sql`roles.region`;
  const matches = filter.id === 'status' ? selected.map((value) => statusCondition(value as MembershipStatusFilter, effectiveStatus))
    : selected.map((value) => sql`${field} = ${value}`);
  const match = sql`(${sql.join(matches, sql` or `)})`;
  return filter.operator === 'ne' || filter.operator === 'notInArray'
    ? sql`not coalesce(${match},false)` : match;
}

function queryParts(raw: MemberFilters) {
  const filters = normalized(raw);
  // Unconditional, independent of any status filter: the roster lists member profiles, so a user
  // with no profile at all (e.g. a plain administrator account) must never appear here just because
  // no status restriction happens to be selected -- the old default-to-active status filter used to
  // exclude such rows only as an accidental side effect of always requiring a matched status.
  const conditions = [sql`p.id is not null`];
  if (filters.q) {
    const pattern = `%${filters.q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    // One indexed lookup per column, combined with a union, so each branch can use its own trigram GIN index (profiles_*_trgm_idx
    // and users_display_email_trgm_idx, migration 0081). An OR across the users and profiles tables in one predicate cannot use
    // any of them and scans both tables in full. Every predicate below repeats its index's expression exactly, which is what lets
    // the planner pick the index. The email branch matches the displayed address (email_display, falling back to email).
    conditions.push(sql`p.id in (
      select id from profiles where first_name ilike ${pattern} escape '\\'
      union select id from profiles where last_name ilike ${pattern} escape '\\'
      union select id from profiles where (first_name || ' ' || last_name) ilike ${pattern} escape '\\'
      union select sp.id from users su join profiles sp on sp.user_id = su.id where coalesce(su.email_display, su.email) ilike ${pattern} escape '\\')`);
  }
  const effectiveStatus = sql`case when m.status = 'archived' or u.account_state = 'deleted' then 'archived' when ((m.status in ('active','complimentary','canceled') and m.valid_until >= current_date) or (m.status='grace' and coalesce(m.grace_ends_on,m.valid_until) >= current_date)) and u.account_state <> 'suspended' then 'active' else 'expired' end`;
  const advancedStatus = filters.advancedFilters.some((filter) => filter.id === 'status' && advancedCondition(filter, effectiveStatus));
  if (!advancedStatus && filters.statuses.length) {
    const matches = filters.statuses.map((value) => statusCondition(value, effectiveStatus));
    conditions.push(sql`(${sql.join(matches, sql` or `)})`);
  }
  if (filters.expiresFrom) conditions.push(sql`m.valid_until >= ${filters.expiresFrom}`);
  if (filters.expiresTo) conditions.push(sql`m.valid_until <= ${filters.expiresTo}`);
  if (filters.federations.length) conditions.push(sql`roles.federation in (${sql.join(filters.federations.map((value) => sql`${value}`), sql`,`)})`);
  if (filters.regions.length) conditions.push(sql`roles.region in (${sql.join(filters.regions.map((value) => sql`${value}`), sql`,`)})`);
  if (filters.officialStatuses.length) {
    // Matches a member holding ANY selected status on a current role of the matching type.
    const matches = filters.officialStatuses.map((token) => {
      const [roleType, ...rest] = token.split(':');
      return sql`exists (select 1 from professional_roles opr where opr.profile_id=p.id and opr.effective_to is null and opr.role_type=${roleType} and ${rest.join(':')} = any(opr.official_statuses))`;
    });
    conditions.push(sql`(${sql.join(matches, sql` or `)})`);
  }
  if (filters.membershipTypes.length) {
    const matches = filters.membershipTypes.map((value) => value === 'combo'
      ? sql`(roles.has_judge and roles.has_steward)`
      : sql`roles.role_types @> array[${value}]::text[]`);
    conditions.push(sql`(${sql.join(matches, sql` or `)})`);
  }
  const advanced = filters.advancedFilters.map((filter) => advancedCondition(filter, effectiveStatus)).filter((condition): condition is SQL => condition !== null);
  if (advanced.length) conditions.push(sql`(${sql.join(advanced, filters.joinOperator === 'or' ? sql` or ` : sql` and `)})`);
  const sortExpression = (field: SortField) => field === 'email' ? sql`u.email` : field === 'status' ? effectiveStatus
    : field === 'type' ? sql`roles.membership_type` : field === 'federation' ? sql`roles.federation`
      : field === 'country' ? sql`p.country_code` : field === 'region' ? sql`roles.region`
        : field === 'expires' ? sql`m.valid_until` : field === 'lastPayment' ? sql`payment.last_payment_at`
          : field === 'updated' ? sql`greatest(u.updated_at,p.updated_at,coalesce(m.updated_at,p.updated_at))` : sql`p.last_name`;
  const sorts = filters.sorts.length ? filters.sorts : [{ id: filters.sort, desc: filters.direction === 'desc' }];
  const order = sql`${sql.join(sorts.flatMap(({ id, desc }) => [
    sql`${sortExpression(id)} ${desc ? sql`desc` : sql`asc`} nulls last`,
    ...(id === 'name' ? [sql`p.first_name ${desc ? sql`desc` : sql`asc`} nulls last`] : []),
  ]), sql`, `)}, p.first_name, p.id, u.id`;
  return { effectiveStatus, filters, order, where: sql.join(conditions, sql` and `) };
}

// Each lateral join below returns exactly one row per member (an aggregate without GROUP BY, or LIMIT 1), so a join the query
// never references cannot change how many rows match. The page query's two phases and the count query each include only the
// joins their WHERE and ORDER BY clauses actually read, which skips the per-member work on the role, payment and support tables
// for every member that is not on the page being shown.
const baseFrom = sql`from users u left join profiles p on p.user_id = u.id`;
const lateralJoins: Record<'m' | 'roles' | 'payment' | 'app_roles' | 'support', SQL> = {
  m: sql`left join lateral (select status, valid_until, grace_ends_on, updated_at from memberships where profile_id=p.id order by valid_until desc,id desc limit 1) m on true`,
  roles: sql`left join lateral (select array_agg(distinct role_type)::text[] role_types, bool_or(role_type='judge') has_judge, bool_or(role_type='steward') has_steward, min(national_federation_country_code) federation, min(idoc_region) region,(select array_agg(distinct oc.concat_status order by oc.concat_status) from (select role_type||':'||st concat_status from professional_roles r2, unnest(r2.official_statuses) st where r2.profile_id=p.id and r2.effective_to is null) oc) official_statuses,case when bool_or(role_type='judge') and bool_or(role_type='steward') then 'combo' when count(distinct role_type)=1 then min(role_type) else null end membership_type from professional_roles where profile_id=p.id and effective_to is null) roles on true`,
  payment: sql`left join lateral (select max(paid_at) last_payment_at from payments where profile_id=p.id) payment on true`,
  app_roles: sql`left join lateral (select bool_or(role='administrator') is_administrator, bool_or(role='super_admin') is_super_admin from application_roles where user_id=u.id and revoked_at is null) app_roles on true`,
  support: sql`left join lateral (select true has_support_history from support_conversations where member_user_id=u.id limit 1) support on true`,
};
const lateralAliases = Object.keys(lateralJoins) as (keyof typeof lateralJoins)[];
const from = sql`${baseFrom} ${sql.join(lateralAliases.map((alias) => lateralJoins[alias]), sql` `)}`;
const sqlDialect = new PgDialect();
/** `from` with only the lateral joins whose alias the given clauses reference. */
function fromFor(...clauses: SQL[]): SQL {
  const text = clauses.map((clause) => sqlDialect.sqlToQuery(clause).sql).join(' ');
  const needed = lateralAliases.filter((alias) => new RegExp(`\\b${alias}\\.`).test(text));
  return needed.length ? sql`${baseFrom} ${sql.join(needed.map((alias) => lateralJoins[alias]), sql` `)}` : baseFrom;
}

async function authorize() { const actor = await requireAccountAccess('administration'); requireAdministrator(actor); return actor; }

export async function listAdminMembers(input: MemberFilters = {}) {
  await authorize();
  const { effectiveStatus, filters, order, where } = queryParts(input);
  const offset = (filters.page - 1) * filters.pageSize;
  // Two phases: the inner query finds only the ids on the requested page (filtering and sorting with just the joins those need),
  // and the outer query then computes every displayed column for those few members. Sorting by name with the default filters
  // reads the first page straight off profiles_name_sort_idx, and no per-member role, payment or support work happens for the
  // thousands of members who are not on the page.
  const pageIds = sql`select u.id ${fromFor(where, order)} where ${where} order by ${order} limit ${filters.pageSize} offset ${offset}`;
  const [rows, counts] = await Promise.all([
    db.execute<AdminMemberRow>(sql`select p.id "profileId",u.id "userId",p.first_name "firstName",p.last_name "lastName",u.email,p.country_code country,m.valid_until "validUntil",${effectiveStatus} status,roles.federation,roles.region,roles.official_statuses "officialStatuses",roles.membership_type "membershipType",payment.last_payment_at "lastPaymentAt",greatest(u.updated_at,coalesce(p.updated_at,u.updated_at),coalesce(m.updated_at,u.updated_at)) "updatedAt",coalesce(support.has_support_history,false) "hasSupportHistory",coalesce(p.is_board_member,false) "isBoardMember",coalesce(app_roles.is_administrator,false) "isAdministrator",coalesce(app_roles.is_super_admin,false) "isSuperAdmin" ${from} where u.id in (${pageIds}) order by ${order}`),
    db.execute<{ count: number }>(sql`select count(*)::int count ${fromFor(where)} where ${where}`),
  ]);
  return { filters, pageSize: filters.pageSize, rows: [...rows], total: counts[0]?.count ?? 0 };
}

export async function exportAdminMembers(input: MemberFilters = {}, selectedUserIds?: number[]) {
  const actor = await authorize();
  const { effectiveStatus, filters, order, where } = queryParts(input);
  const selectedWhere = selectedUserIds?.length ? sql` and u.id in (${sql.join(selectedUserIds.map((id) => sql`${id}`), sql`,`)})` : sql``;
  const rows = await db.execute<AdminMemberRow>(sql`select p.id "profileId",u.id "userId",p.first_name "firstName",p.last_name "lastName",u.email,p.country_code country,m.valid_until "validUntil",${effectiveStatus} status,roles.federation,roles.region,roles.official_statuses "officialStatuses",case when roles.has_judge and roles.has_steward then 'combo' when cardinality(roles.role_types)=1 then roles.role_types[1] else null end "membershipType",coalesce(p.is_board_member,false) "isBoardMember",coalesce(app_roles.is_administrator,false) "isAdministrator",coalesce(app_roles.is_super_admin,false) "isSuperAdmin" ${from} where ${where}${selectedWhere} order by ${order} limit ${MEMBER_EXPORT_LIMIT + 1}`);
  if (rows.length > MEMBER_EXPORT_LIMIT) throw new Error(`Export exceeds the safe limit of ${MEMBER_EXPORT_LIMIT} members. Narrow the filters and retry.`);
  await db.insert(auditLog).values({ action: 'admin.memberships.exported', actorId: actor.id, afterJson: { filters, resultCount: rows.length, selectedCount: selectedUserIds?.length ?? null }, entityId: 'membership-filtered-results', entityType: 'export' });
  return [...rows];
}
