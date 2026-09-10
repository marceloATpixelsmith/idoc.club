import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog } from '@/lib/db/schema';
import { requireAdministrator } from './authorization';
import { requireAccountAccess } from './data-access';

export const DEFAULT_ADMIN_MEMBER_PAGE_SIZE = 25;
export const MEMBER_EXPORT_LIMIT = 25_000;
export const MEMBERSHIP_STATUSES = ['active', 'expired', 'archived', 'without_active', 'administrator', 'super_admin', 'onboarding', 'test'] as const;
export type MembershipStatusFilter = typeof MEMBERSHIP_STATUSES[number];
// Next.js searchParams values are string | string[] | undefined at runtime (a repeated query key
// becomes an array) regardless of a narrower page-level annotation, so every filter accepts that
// real shape; normalized() below resolves an array to its first value (matching the convention
// already used by lib/news/articles.ts, lib/seminars/seminars.ts, and lib/support/inbox.ts) before
// calling any string method on it.
type RawFilterValue = string | string[] | undefined;
export type MemberFilters = {
  column?: RawFilterValue; country?: RawFilterValue; expiresFrom?: RawFilterValue; expiresTo?: RawFilterValue; federation?: RawFilterValue;
  membershipType?: RawFilterValue; page?: number | RawFilterValue; pageSize?: number | RawFilterValue;
  direction?: RawFilterValue; filters?: RawFilterValue; q?: RawFilterValue; region?: RawFilterValue; sort?: RawFilterValue;
  status?: RawFilterValue;
};

export type AdminMemberRow = {
  country: string | null; email: string; federation: string | null; firstName: string | null;
  lastName: string | null; lastPaymentAt: Date | null; membershipType: string | null; profileId: number | null; region: string | null;
  status: string; updatedAt: Date; userId: number; validUntil: string | null;
};

const SORT_FIELDS = ['name', 'email', 'status', 'type', 'federation', 'country', 'region', 'expires', 'lastPayment', 'updated'] as const;
type SortField = typeof SORT_FIELDS[number];
const MEMBERSHIP_TYPE_OPTIONS = ['judge', 'steward', 'combo', 'veterinarian'] as const;
type MembershipTypeOption = typeof MEMBERSHIP_TYPE_OPTIONS[number];

export class MemberFilterRangeError extends Error {
  constructor() {
    super('Choose valid expiration dates with the start date on or before the end date.');
    this.name = 'MemberFilterRangeError';
  }
}

// An array-valued (repeated-key) filter resolves to its first value rather than crashing --
// matching the convention already used by lib/news/articles.ts, lib/seminars/seminars.ts, and
// lib/support/inbox.ts -- so a string method is never called directly on an array.
function firstValue(value: RawFilterValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
function pageNumber(value: number | RawFilterValue): number {
  return Number(typeof value === 'number' ? value : firstValue(value));
}

type NormalizedMemberFilters = {
  country?: string; expiresFrom?: string; expiresTo?: string; federation?: string;
  direction: 'asc' | 'desc'; membershipType?: MembershipTypeOption; page: number; pageSize: 10 | 25 | 50 | 100; q?: string; region?: string;
  sort: SortField; status: MembershipStatusFilter;
};

function normalized(input: MemberFilters): NormalizedMemberFilters {
  const page = pageNumber(input.page);
  const membershipType = firstValue(input.membershipType);
  const rawSort = firstValue(input.sort);
  let parsedSort: { desc?: boolean; id?: string } | undefined;
  try { parsedSort = rawSort?.startsWith('[') ? JSON.parse(rawSort)[0] : undefined; } catch { parsedSort = undefined; }
  const legacySort = parsedSort?.id ?? rawSort;
  const [legacyField, legacyDirection] = legacySort?.split('_') ?? [];
  const sort = legacyField && SORT_FIELDS.includes(legacyField as SortField) ? legacyField : legacySort;
  const status = firstValue(input.status);
  const rawPageSize = pageNumber(input.pageSize);
  const filters: NormalizedMemberFilters = {
    direction: parsedSort?.desc === true ? 'desc' : parsedSort?.desc === false ? 'asc' : firstValue(input.direction) === 'desc' || legacyDirection === 'desc' ? 'desc' : 'asc',
    country: firstValue(input.country)?.trim().toUpperCase() || undefined,
    expiresFrom: firstValue(input.expiresFrom) || undefined,
    expiresTo: firstValue(input.expiresTo) || undefined,
    federation: firstValue(input.federation)?.trim().toUpperCase() || undefined,
    membershipType: membershipType && MEMBERSHIP_TYPE_OPTIONS.includes(membershipType as MembershipTypeOption) ? membershipType as MembershipTypeOption : undefined,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 25, 50, 100].includes(rawPageSize) ? rawPageSize as 10 | 25 | 50 | 100 : DEFAULT_ADMIN_MEMBER_PAGE_SIZE,
    q: firstValue(input.q)?.trim().slice(0, 200) || undefined,
    region: firstValue(input.region)?.trim().slice(0, 40) || undefined,
    sort: sort && SORT_FIELDS.includes(sort as SortField) ? sort as SortField : 'name',
    status: status && MEMBERSHIP_STATUSES.includes(status as MembershipStatusFilter) ? status as MembershipStatusFilter : 'active',
  };
  const rawAdvancedFilters = firstValue(input.filters);
  if (rawAdvancedFilters) {
    try {
      const advanced = JSON.parse(rawAdvancedFilters);
      if (Array.isArray(advanced)) for (const filter of advanced) {
        const value = Array.isArray(filter?.value) ? filter.value[0] : filter?.value;
        if (typeof value !== 'string') continue;
        if (filter.id === 'status' && MEMBERSHIP_STATUSES.includes(value as MembershipStatusFilter)) filters.status = value as MembershipStatusFilter;
        else if (filter.id === 'type' && MEMBERSHIP_TYPE_OPTIONS.includes(value as MembershipTypeOption)) filters.membershipType = value as MembershipTypeOption;
        else if (filter.id === 'country') filters.country = value.trim().slice(0, 2).toUpperCase() || undefined;
        else if (filter.id === 'federation') filters.federation = value.trim().slice(0, 2).toUpperCase() || undefined;
        else if (filter.id === 'region') filters.region = value.trim().slice(0, 40) || undefined;
        else if (filter.id === 'expires') {
          const values = Array.isArray(filter.value) ? filter.value : [filter.value];
          const dates = values.map((item: unknown) => { if (typeof item !== 'string' || !/^\d+$/.test(item)) return item; const date = new Date(Number(item)); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; });
          if (filter.operator === 'isBetween') [filters.expiresFrom, filters.expiresTo] = dates as [string?, string?];
          else if (filter.operator === 'gt' || filter.operator === 'gte') filters.expiresFrom = dates[0] as string;
          else if (filter.operator === 'lt' || filter.operator === 'lte') filters.expiresTo = dates[0] as string;
          else if (filter.operator === 'eq') [filters.expiresFrom, filters.expiresTo] = [dates[0] as string, dates[0] as string];
        }
      }
    } catch { /* Invalid advanced state is ignored and server defaults remain authoritative. */ }
  }
  const validDate = (value: string | undefined) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!validDate(filters.expiresFrom) || !validDate(filters.expiresTo)
    || (filters.expiresFrom && filters.expiresTo && filters.expiresFrom > filters.expiresTo)) throw new MemberFilterRangeError();
  return filters;
}

function queryParts(raw: MemberFilters) {
  const filters = normalized(raw);
  const conditions = [sql`true`];
  if (filters.q) {
    const pattern = `%${filters.q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    conditions.push(sql`(u.email ilike ${pattern} escape '\\' or p.first_name ilike ${pattern} escape '\\' or p.last_name ilike ${pattern} escape '\\' or concat_ws(' ', p.first_name, p.last_name) ilike ${pattern} escape '\\')`);
  }
  const effectiveStatus = sql`case when m.status = 'archived' or u.account_state = 'deleted' then 'archived' when ((m.status in ('active','complimentary','canceled') and m.valid_until >= current_date) or (m.status='grace' and coalesce(m.grace_ends_on,m.valid_until) >= current_date)) and u.account_state <> 'suspended' then 'active' else 'expired' end`;
  if (filters.status === 'administrator') conditions.push(sql`app_roles.is_administrator`);
  else if (filters.status === 'super_admin') conditions.push(sql`app_roles.is_super_admin`);
  else if (filters.status === 'onboarding') conditions.push(sql`u.account_state in ('unverified','onboarding','migrated_pending')`);
  else if (filters.status === 'test') conditions.push(sql`(u.email like '%+test@%' or u.email like '%@example.test' or u.email like '%@example.com')`);
  else if (filters.status === 'without_active') conditions.push(sql`${effectiveStatus} <> 'active'`);
  else conditions.push(sql`${effectiveStatus} = ${filters.status}`);
  if (filters.expiresFrom) conditions.push(sql`m.valid_until >= ${filters.expiresFrom}`);
  if (filters.expiresTo) conditions.push(sql`m.valid_until <= ${filters.expiresTo}`);
  if (filters.country) conditions.push(sql`p.country_code = ${filters.country}`);
  if (filters.federation) conditions.push(sql`roles.federation = ${filters.federation}`);
  if (filters.region) conditions.push(sql`roles.region = ${filters.region}`);
  if (filters.membershipType) conditions.push(filters.membershipType === 'combo'
    ? sql`roles.has_judge and roles.has_steward`
    : sql`roles.role_types @> array[${filters.membershipType}]::text[]`);
  const direction = filters.direction === 'desc' ? sql`desc` : sql`asc`;
  const sortExpression = filters.sort === 'email' ? sql`u.email` : filters.sort === 'status' ? effectiveStatus
    : filters.sort === 'type' ? sql`roles.membership_type` : filters.sort === 'federation' ? sql`roles.federation`
      : filters.sort === 'country' ? sql`p.country_code` : filters.sort === 'region' ? sql`roles.region`
        : filters.sort === 'expires' ? sql`m.valid_until` : filters.sort === 'lastPayment' ? sql`payment.last_payment_at`
          : filters.sort === 'updated' ? sql`greatest(u.updated_at,p.updated_at,coalesce(m.updated_at,p.updated_at))` : sql`p.last_name`;
  const order = sql`${sortExpression} ${direction} nulls last, p.first_name ${direction}, coalesce(p.id,u.id) ${direction}, u.id ${direction}`;
  return { effectiveStatus, filters, order, where: sql.join(conditions, sql` and `) };
}

const from = sql`from idoc.users u left join idoc.profiles p on p.user_id = u.id
  left join lateral (select status, valid_until, updated_at from idoc.memberships where profile_id=p.id order by valid_until desc,id desc limit 1) m on true
  left join lateral (select array_agg(distinct role_type)::text[] role_types, bool_or(role_type='judge') has_judge, bool_or(role_type='steward') has_steward, min(national_federation_country_code) federation, min(idoc_region) region,case when bool_or(role_type='judge') and bool_or(role_type='steward') then 'combo' when count(distinct role_type)=1 then min(role_type) else null end membership_type from idoc.professional_roles where profile_id=p.id and effective_to is null) roles on true
  left join lateral (select max(paid_at) last_payment_at from idoc.payments where profile_id=p.id) payment on true
  left join lateral (select bool_or(role='administrator') is_administrator, bool_or(role='super_admin') is_super_admin from idoc.application_roles where user_id=u.id and revoked_at is null) app_roles on true`;

async function authorize() { const actor = await requireAccountAccess('administration'); requireAdministrator(actor); return actor; }

export async function listAdminMembers(input: MemberFilters = {}) {
  await authorize();
  const { effectiveStatus, filters, order, where } = queryParts(input);
  const offset = (filters.page - 1) * filters.pageSize;
  const [rows, counts] = await Promise.all([
    db.execute<AdminMemberRow>(sql`select p.id "profileId",u.id "userId",p.first_name "firstName",p.last_name "lastName",u.email,p.country_code country,m.valid_until "validUntil",${effectiveStatus} status,roles.federation,roles.region,roles.membership_type "membershipType",payment.last_payment_at "lastPaymentAt",greatest(u.updated_at,coalesce(p.updated_at,u.updated_at),coalesce(m.updated_at,u.updated_at)) "updatedAt" ${from} where ${where} order by ${order} limit ${filters.pageSize} offset ${offset}`),
    db.execute<{ count: number }>(sql`select count(*)::int count ${from} where ${where}`),
  ]);
  return { filters, pageSize: filters.pageSize, rows: [...rows], total: counts[0]?.count ?? 0 };
}

export async function exportAdminMembers(input: MemberFilters = {}) {
  const actor = await authorize();
  const { effectiveStatus, filters, order, where } = queryParts(input);
  const rows = await db.execute<AdminMemberRow>(sql`select p.id "profileId",u.id "userId",p.first_name "firstName",p.last_name "lastName",u.email,p.country_code country,m.valid_until "validUntil",${effectiveStatus} status,roles.federation,roles.region,case when roles.has_judge and roles.has_steward then 'combo' when cardinality(roles.role_types)=1 then roles.role_types[1] else null end "membershipType" ${from} where ${where} order by ${order} limit ${MEMBER_EXPORT_LIMIT + 1}`);
  if (rows.length > MEMBER_EXPORT_LIMIT) throw new Error(`Export exceeds the safe limit of ${MEMBER_EXPORT_LIMIT} members. Narrow the filters and retry.`);
  await db.insert(auditLog).values({ action: 'admin.memberships.exported', actorId: actor.id, afterJson: { filters, resultCount: rows.length }, entityId: 'membership-filtered-results', entityType: 'export' });
  return [...rows];
}
