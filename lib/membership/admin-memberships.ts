import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog } from '@/lib/db/schema';
import { requireAdministrator } from './authorization';
import { requireAccountAccess } from './data-access';

export const ADMIN_MEMBER_PAGE_SIZE = 25;
export const MEMBER_EXPORT_LIMIT = 25_000;
export const MEMBERSHIP_STATUSES = ['never_paid', 'active', 'grace', 'expired', 'paused', 'suspended', 'revoked', 'archived', 'deleted'] as const;
export type MembershipStatusFilter = typeof MEMBERSHIP_STATUSES[number];
export type MemberFilters = {
  country?: string; expiresFrom?: string; expiresTo?: string; federation?: string;
  membershipType?: 'judge' | 'steward' | 'combo' | 'veterinarian'; page?: number;
  q?: string; region?: string; sort?: 'name_asc' | 'name_desc' | 'expires_asc' | 'expires_desc';
  status?: MembershipStatusFilter;
};

export type AdminMemberRow = {
  country: string; email: string; federation: string | null; firstName: string;
  lastName: string; membershipType: string | null; profileId: number; region: string | null;
  status: string; userId: number; validUntil: string | null;
};

function normalized(input: MemberFilters): Required<Pick<MemberFilters, 'page' | 'sort' | 'status'>> & MemberFilters {
  return {
    ...input,
    country: input.country?.trim().toUpperCase() || undefined,
    federation: input.federation?.trim().toUpperCase() || undefined,
    page: Math.max(1, Math.trunc(input.page ?? 1)),
    q: input.q?.trim().slice(0, 200) || undefined,
    region: input.region?.trim().slice(0, 40) || undefined,
    sort: input.sort ?? 'name_asc',
    status: input.status && MEMBERSHIP_STATUSES.includes(input.status) ? input.status : 'active',
  };
}

function queryParts(raw: MemberFilters) {
  const filters = normalized(raw);
  const conditions = [sql`true`];
  if (filters.q) {
    const pattern = `%${filters.q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    conditions.push(sql`(u.email ilike ${pattern} escape '\\' or p.first_name ilike ${pattern} escape '\\' or p.last_name ilike ${pattern} escape '\\' or concat_ws(' ', p.first_name, p.last_name) ilike ${pattern} escape '\\')`);
  }
  const effectiveStatus = sql`case when u.account_state = 'deleted' then 'deleted' when u.account_state = 'suspended' then 'revoked' when m.status is null then 'never_paid' when m.status = 'grace' then 'grace' when m.status = 'suspended' then 'suspended' when m.status = 'archived' then 'archived' when m.status = 'paused' then 'paused' when m.status in ('active','complimentary','canceled') and m.valid_until >= current_date then 'active' else 'expired' end`;
  conditions.push(sql`${effectiveStatus} = ${filters.status}`);
  if (filters.expiresFrom) conditions.push(sql`m.valid_until >= ${filters.expiresFrom}`);
  if (filters.expiresTo) conditions.push(sql`m.valid_until <= ${filters.expiresTo}`);
  if (filters.country) conditions.push(sql`p.country_code = ${filters.country}`);
  if (filters.federation) conditions.push(sql`roles.federation = ${filters.federation}`);
  if (filters.region) conditions.push(sql`roles.region = ${filters.region}`);
  if (filters.membershipType) conditions.push(filters.membershipType === 'combo'
    ? sql`roles.has_judge and roles.has_steward`
    : sql`roles.role_types @> array[${filters.membershipType}]::text[]`);
  const order = filters.sort === 'name_desc' ? sql`p.last_name desc, p.first_name desc, p.id desc`
    : filters.sort === 'expires_asc' ? sql`m.valid_until asc nulls last, p.id asc`
      : filters.sort === 'expires_desc' ? sql`m.valid_until desc nulls last, p.id asc`
        : sql`p.last_name asc, p.first_name asc, p.id asc`;
  return { effectiveStatus, filters, order, where: sql.join(conditions, sql` and `) };
}

const from = sql`from idoc.profiles p join idoc.users u on u.id = p.user_id
  left join lateral (select status, valid_until from idoc.memberships where profile_id=p.id order by valid_until desc,id desc limit 1) m on true
  left join lateral (select array_agg(distinct role_type)::text[] role_types, bool_or(role_type='judge') has_judge, bool_or(role_type='steward') has_steward, min(national_federation_country_code) federation, min(idoc_region) region from idoc.professional_roles where profile_id=p.id and effective_to is null) roles on true`;

async function authorize() { const actor = await requireAccountAccess('administration'); requireAdministrator(actor); return actor; }

export async function listAdminMembers(input: MemberFilters = {}) {
  await authorize();
  const { effectiveStatus, filters, order, where } = queryParts(input);
  const offset = (filters.page - 1) * ADMIN_MEMBER_PAGE_SIZE;
  const [rows, counts] = await Promise.all([
    db.execute<AdminMemberRow>(sql`select p.id "profileId",u.id "userId",p.first_name "firstName",p.last_name "lastName",u.email,p.country_code country,m.valid_until "validUntil",${effectiveStatus} status,roles.federation,roles.region,case when roles.has_judge and roles.has_steward then 'combo' when cardinality(roles.role_types)=1 then roles.role_types[1] else null end "membershipType" ${from} where ${where} order by ${order} limit ${ADMIN_MEMBER_PAGE_SIZE} offset ${offset}`),
    db.execute<{ count: number }>(sql`select count(*)::int count ${from} where ${where}`),
  ]);
  return { filters, pageSize: ADMIN_MEMBER_PAGE_SIZE, rows: [...rows], total: counts[0]?.count ?? 0 };
}

export async function exportAdminMembers(input: MemberFilters = {}) {
  const actor = await authorize();
  const { effectiveStatus, filters, order, where } = queryParts(input);
  const rows = await db.execute<AdminMemberRow>(sql`select p.id "profileId",u.id "userId",p.first_name "firstName",p.last_name "lastName",u.email,p.country_code country,m.valid_until "validUntil",${effectiveStatus} status,roles.federation,roles.region,case when roles.has_judge and roles.has_steward then 'combo' when cardinality(roles.role_types)=1 then roles.role_types[1] else null end "membershipType" ${from} where ${where} order by ${order} limit ${MEMBER_EXPORT_LIMIT + 1}`);
  if (rows.length > MEMBER_EXPORT_LIMIT) throw new Error(`Export exceeds the safe limit of ${MEMBER_EXPORT_LIMIT} members. Narrow the filters and retry.`);
  await db.insert(auditLog).values({ action: 'admin.memberships.exported', actorId: actor.id, afterJson: { filters, resultCount: rows.length }, entityId: 'membership-filtered-results', entityType: 'export' });
  return [...rows];
}
