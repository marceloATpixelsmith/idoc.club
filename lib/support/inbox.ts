import 'server-only';

import { z } from 'zod';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, isAdministrator, requireAdministrator, requireSuperAdmin } from '@/lib/membership/authorization';

export const SUPPORT_CATEGORIES = ['billing_membership', 'seminars', 'technical_support'] as const;
export const SUPPORT_STATUSES = ['open', 'admin_responded', 'member_replied', 'closed'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
type ConversationRow = { category: SupportCategory; public_id: string; status: string; subject: string; updated_at: Date };
type AdminConversationRow = ConversationRow & { assigned_admin_keys: string[]; id: number; member_email: string; member_name: string };
export type AdminSupportRow = {
  assignee_name: string; category: SupportCategory; member_email: string; member_name: string; profile_id: number | null;
  public_id: string; status: string; subject: string; total_count: number; unread: boolean; updated_at: Date;
};

export const CATEGORY_LABELS: Record<SupportCategory, string> = {
  billing_membership: 'Billing/Membership',
  seminars: 'Seminars',
  technical_support: 'Technical Support',
};
export const STATUS_LABELS: Record<string, string> = {
  admin_responded: 'Responded to by admin', closed: 'Closed/Resolved', member_replied: 'Member Replied', open: 'Open',
};

const categorySchema = z.enum(SUPPORT_CATEGORIES);
const publicIdSchema = z.string().uuid();
const messageSchema = z.string().trim().min(1).max(10_000);
const subjectSchema = z.string().trim().min(1).max(160);
const keySchema = z.string().uuid();

export class SupportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupportValidationError';
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SupportValidationError('Review the support form fields.');
  return result.data;
}
async function requireSupportMember() {
  const actor = await requireAccountAccess('member');
  if (isAdministrator(actor)) throw new AuthorizationError();
  return actor;
}

async function resolveEligibleAdministrator(value: unknown): Promise<number | null> {
  if (typeof value !== 'string' || value.length > 255) return null;
  const [row] = await client<{ id: number }[]>`select u.id from idoc.users u join idoc.application_roles r on r.user_id=u.id
    where lower(u.email)=lower(${value.trim()}) and r.revoked_at is null and r.role in ('administrator','super_admin') and u.account_state='active' limit 1`;
  return row?.id ?? null;
}

export async function createConversation(input: { body: unknown; category: unknown; idempotencyKey: unknown; subject: unknown }) {
  const actor = await requireSupportMember();
  const body = parse(messageSchema, input.body);
  const category = parse(categorySchema, input.category);
  const idempotencyKey = parse(keySchema, input.idempotencyKey);
  const subject = parse(subjectSchema, input.subject);
  return client.begin(async (sql) => {
    const existing = await sql<{ public_id: string }[]>`
      select c.public_id from idoc.support_messages m join idoc.support_conversations c on c.id=m.conversation_id
      where m.author_user_id=${actor.id} and m.idempotency_key=${idempotencyKey}::uuid limit 1`;
    if (existing[0]) return existing[0].public_id;
    const defaults = await sql<{ administrator_user_id: number }[]>`select d.administrator_user_id from idoc.support_category_defaults d
      join idoc.users u on u.id=d.administrator_user_id and u.account_state='active' where d.category=${category}
      and exists(select 1 from idoc.application_roles r where r.user_id=u.id and r.revoked_at is null and r.role in ('administrator','super_admin'))`;
    const assigned = defaults.map((row) => row.administrator_user_id);
    const rows = await sql<{ id: number; public_id: string }[]>`
      insert into idoc.support_conversations (member_user_id,category,subject,status,assigned_admin_user_id,member_read_at)
      values (${actor.id},${category},${subject},'open',${assigned[0] ?? null},now()) returning id,public_id`;
    await sql`insert into idoc.support_messages (conversation_id,author_user_id,author_side,body,idempotency_key)
      values (${rows[0].id},${actor.id},'member',${body},${idempotencyKey}::uuid)`;
    for (const administratorId of assigned) await sql`insert into idoc.support_conversation_administrators(conversation_id,administrator_user_id)
      values(${rows[0].id},${administratorId}) on conflict do nothing`;
    return rows[0].public_id;
  });
}

export async function listOwnConversations() {
  const actor = await requireSupportMember();
  return client`select public_id,subject,category,status,updated_at,
    exists(select 1 from idoc.support_messages m where m.conversation_id=c.id and m.author_side='admin'
      and (c.member_read_at is null or m.created_at>c.member_read_at)) unread
    from idoc.support_conversations c where member_user_id=${actor.id} order by updated_at desc`;
}

export async function memberUnreadCount() {
  const actor = await requireSupportMember();
  const [row] = await client<{ count: number }[]>`select count(*)::int count from idoc.support_messages m
    join idoc.support_conversations c on c.id=m.conversation_id where c.member_user_id=${actor.id}
    and m.author_side='admin' and (c.member_read_at is null or m.created_at>c.member_read_at)`;
  return row?.count ?? 0;
}

export async function getOwnConversation(publicIdValue: unknown) {
  const actor = await requireSupportMember();
  const parsedPublicId = publicIdSchema.safeParse(publicIdValue);
  if (!parsedPublicId.success) return null;
  const publicId = parsedPublicId.data;
  return client.begin(async (sql) => {
    const rows = await sql<ConversationRow[]>`select public_id,subject,category,status,updated_at from idoc.support_conversations
      where public_id=${publicId}::uuid and member_user_id=${actor.id} for update`;
    if (!rows[0]) return null;
    await sql`update idoc.support_conversations set member_read_at=now() where public_id=${publicId}::uuid and member_user_id=${actor.id}`;
    const messages = await sql`select author_side,body,created_at from idoc.support_messages m join idoc.support_conversations c on c.id=m.conversation_id
      where c.public_id=${publicId}::uuid and c.member_user_id=${actor.id} order by m.created_at,m.id`;
    return { ...rows[0], messages };
  });
}

export async function replyAsMember(input: { body: unknown; idempotencyKey: unknown; publicId: unknown }) {
  const actor = await requireSupportMember();
  const body = parse(messageSchema, input.body); const key = parse(keySchema, input.idempotencyKey); const publicId = parse(publicIdSchema, input.publicId);
  await client.begin(async (sql) => {
    const rows = await sql<{ id: number; status: string }[]>`select id,status from idoc.support_conversations where public_id=${publicId}::uuid and member_user_id=${actor.id} for update`;
    if (!rows[0]) throw new SupportValidationError('Conversation not found.');
    if (rows[0].status === 'closed') throw new SupportValidationError('Closed conversations cannot receive replies.');
    const inserted = await sql`insert into idoc.support_messages (conversation_id,author_user_id,author_side,body,idempotency_key)
      values (${rows[0].id},${actor.id},'member',${body},${key}::uuid) on conflict (author_user_id,idempotency_key) do nothing returning id`;
    if (inserted[0]) await sql`update idoc.support_conversations set status='member_replied',updated_at=now(),member_read_at=now() where id=${rows[0].id}`;
  });
}

export async function listEligibleAdministrators() {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  return client`select u.email assignment_key,coalesce(nullif(trim(p.first_name||' '||p.last_name),''),u.email) display_name
    from idoc.users u join idoc.application_roles r on r.user_id=u.id and r.revoked_at is null and r.role in ('administrator','super_admin')
    left join idoc.profiles p on p.user_id=u.id where u.account_state='active' group by u.id,p.first_name,p.last_name order by display_name`;
}

export type SupportSearchParams = Record<string, string | string[] | undefined>;
function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function listAdminConversations(input: SupportSearchParams) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  const pageValue = firstSearchValue(input.page);
  const categoryValue = firstSearchValue(input.category);
  const statusValue = firstSearchValue(input.status);
  const assignedValue = firstSearchValue(input.assigned);
  const searchValue = firstSearchValue(input.q);
  const sortValue = firstSearchValue(input.sort);
  const directionValue = firstSearchValue(input.direction);
  const rawPageSize = Number.parseInt(firstSearchValue(input.pageSize) ?? '', 10);
  const pageSize = [10, 25, 50, 100].includes(rawPageSize) ? rawPageSize : 25;
  const page = Math.max(1, Number.parseInt(pageValue ?? '1', 10) || 1); const offset = (page - 1) * pageSize;
  const category: string | null = SUPPORT_CATEGORIES.includes(categoryValue as SupportCategory) ? categoryValue ?? null : null;
  const status: string | null = SUPPORT_STATUSES.includes(statusValue as never) ? statusValue ?? null : null;
  const assigned = assignedValue === 'unassigned' ? -1 : (assignedValue ? await resolveEligibleAdministrator(assignedValue) : null);
  const search = (searchValue ?? '').trim().slice(0, 100);
  type AdvancedFilter = { id?: string; operator?: string; value?: string | string[] };
  let advancedFilters: AdvancedFilter[] = [];
  try { const parsed = JSON.parse(firstSearchValue(input.filters) ?? '[]'); if (Array.isArray(parsed)) advancedFilters = parsed.slice(0, 20); } catch { /* Invalid URL state is ignored. */ }
  const join = firstSearchValue(input.joinOperator) === 'or' ? 'or' : 'and';
  const escapeLike = (value: string) => value.replaceAll('%', '\\%').replaceAll('_', '\\_');
  // postgres.js query fragments carry their selected-row generic even though fragments are never
  // executed independently; `any` is required here so heterogeneous safe fragments can compose.
  // biome-ignore lint/suspicious/noExplicitAny: postgres.js fragment generics are invariant
  const textCondition = (expression: any, filter: AdvancedFilter) => {
    const value = String(Array.isArray(filter.value) ? filter.value[0] ?? '' : filter.value ?? '').slice(0, 200);
    const pattern = `%${escapeLike(value)}%`;
    if (filter.operator === 'notILike') return client`${expression} not ilike ${pattern} escape '\\'`;
    if (filter.operator === 'eq') return client`lower(${expression})=lower(${value})`;
    if (filter.operator === 'ne') return client`lower(${expression})<>lower(${value})`;
    if (filter.operator === 'isEmpty') return client`coalesce(${expression},'')=''`;
    if (filter.operator === 'isNotEmpty') return client`coalesce(${expression},'')<>''`;
    return client`${expression} ilike ${pattern} escape '\\'`;
  };
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous postgres.js query fragments
  const advancedConditions: any[] = [];
  for (const filter of advancedFilters) {
    const values = (Array.isArray(filter.value) ? filter.value : [filter.value]).filter((value): value is string => typeof value === 'string');
    const positive = filter.operator !== 'ne' && filter.operator !== 'notInArray';
    if (filter.id === 'member') advancedConditions.push(textCondition(client`concat_ws(' ',p.first_name,p.last_name,u.email_display,u.email)`, filter));
    else if (filter.id === 'subject') advancedConditions.push(textCondition(client`c.subject`, filter));
    else if (filter.id === 'category') {
      const valid = values.filter((value): value is SupportCategory => SUPPORT_CATEGORIES.includes(value as SupportCategory));
      if (valid.length) advancedConditions.push(positive ? client`c.category in ${client(valid)}` : client`c.category not in ${client(valid)}`);
      else if (filter.operator === 'isEmpty') advancedConditions.push(client`false`); else if (filter.operator === 'isNotEmpty') advancedConditions.push(client`true`);
    } else if (filter.id === 'status') {
      const valid = values.filter((value) => SUPPORT_STATUSES.includes(value as never));
      if (valid.length) advancedConditions.push(positive ? client`c.status in ${client(valid)}` : client`c.status not in ${client(valid)}`);
      else if (filter.operator === 'isEmpty') advancedConditions.push(client`false`); else if (filter.operator === 'isNotEmpty') advancedConditions.push(client`true`);
    } else if (filter.id === 'assigned') {
      const ids = (await Promise.all(values.map(resolveEligibleAdministrator))).filter((id): id is number => id !== null);
      const exists = ids.length ? client`exists(select 1 from idoc.support_conversation_administrators x where x.conversation_id=c.id and x.administrator_user_id in ${client(ids)})` : client`false`;
      if (filter.operator === 'isEmpty') advancedConditions.push(client`not exists(select 1 from idoc.support_conversation_administrators x where x.conversation_id=c.id)`);
      else if (filter.operator === 'isNotEmpty') advancedConditions.push(client`exists(select 1 from idoc.support_conversation_administrators x where x.conversation_id=c.id)`);
      else advancedConditions.push(positive ? exists : client`not (${exists})`);
    } else if (filter.id === 'activity') {
      const dates = values.map((value) => { if (!/^\d+$/.test(value)) return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; const date = new Date(Number(value)); return Number.isNaN(date.valueOf()) ? null : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }).filter((value): value is string => value !== null);
      if (filter.operator === 'eq' && dates[0]) advancedConditions.push(client`(c.updated_at at time zone 'UTC')::date=${dates[0]}::date`);
      else if (filter.operator === 'ne' && dates[0]) advancedConditions.push(client`(c.updated_at at time zone 'UTC')::date<>${dates[0]}::date`);
      else if (filter.operator === 'lt' && dates[0]) advancedConditions.push(client`(c.updated_at at time zone 'UTC')::date<${dates[0]}::date`);
      else if (filter.operator === 'lte' && dates[0]) advancedConditions.push(client`(c.updated_at at time zone 'UTC')::date<=${dates[0]}::date`);
      else if (filter.operator === 'gt' && dates[0]) advancedConditions.push(client`(c.updated_at at time zone 'UTC')::date>${dates[0]}::date`);
      else if (filter.operator === 'gte' && dates[0]) advancedConditions.push(client`(c.updated_at at time zone 'UTC')::date>=${dates[0]}::date`);
      else if (filter.operator === 'isBetween' && dates[0] && dates[1]) advancedConditions.push(client`(c.updated_at at time zone 'UTC')::date between ${dates[0]}::date and ${dates[1]}::date`);
      else if (filter.operator === 'isEmpty') advancedConditions.push(client`false`); else if (filter.operator === 'isNotEmpty') advancedConditions.push(client`true`);
    }
  }
  const advancedWhere = advancedConditions.length ? advancedConditions.slice(1).reduce((result, condition) => join === 'or' ? client`${result} or ${condition}` : client`${result} and ${condition}`, advancedConditions[0]) : client`true`;
  type SortClause = { desc?: boolean; id?: string };
  let parsedSorts: SortClause[] = [];
  try { const parsed = JSON.parse(sortValue ?? '[]'); if (Array.isArray(parsed)) parsedSorts = parsed; } catch { /* Legacy sort state is handled below. */ }
  if (!parsedSorts.length) parsedSorts = [{ desc: directionValue !== 'asc', id: ['activity', 'member', 'status'].includes(sortValue ?? '') ? sortValue : 'activity' }];
  const sortExpressions: Record<string, string> = { activity: 'c.updated_at', assigned: 'assignee_name', category: 'c.category', member: "concat_ws(' ',p.first_name,p.last_name)", status: 'c.status', subject: 'c.subject' };
  const order = parsedSorts.slice(0, 6).flatMap((item) => sortExpressions[item.id ?? ''] ? [`${sortExpressions[item.id ?? '']} ${item.desc ? 'desc' : 'asc'} nulls last`] : []);
  order.push('c.id desc');
  const rows = await client<AdminSupportRow[]>`select c.public_id,c.subject,c.category,c.status,c.updated_at,p.id profile_id,count(*) over()::int total_count,
    coalesce(p.first_name||' '||p.last_name,'') member_name,coalesce(u.email_display,u.email) member_email,
    coalesce((select string_agg(coalesce(nullif(trim(ap.first_name||' '||ap.last_name),''),au.email_display,au.email),', ' order by au.email)
      from idoc.support_conversation_administrators ca join idoc.users au on au.id=ca.administrator_user_id left join idoc.profiles ap on ap.user_id=au.id
      where ca.conversation_id=c.id),'') assignee_name,
    exists(select 1 from idoc.support_messages m where m.conversation_id=c.id and m.author_side='member' and m.created_at>
      coalesce((select rc.read_at from idoc.support_administrator_read_cursors rc where rc.conversation_id=c.id and rc.administrator_user_id=${actor.id}),'-infinity'::timestamptz)) unread
    from idoc.support_conversations c join idoc.users u on u.id=c.member_user_id left join idoc.profiles p on p.user_id=u.id
    where (${category}::text is null or c.category=${category}) and (${status}::text is null or c.status=${status})
    and (${assigned}::int is null or (${assigned}=-1 and not exists(select 1 from idoc.support_conversation_administrators ca where ca.conversation_id=c.id))
      or exists(select 1 from idoc.support_conversation_administrators ca where ca.conversation_id=c.id and ca.administrator_user_id=${assigned}))
    and (${search}='' or c.subject ilike ${`%${escapeLike(search)}%`} escape '\\' or u.email ilike ${`%${escapeLike(search)}%`} escape '\\' or concat_ws(' ',p.first_name,p.last_name) ilike ${`%${escapeLike(search)}%`} escape '\\')
    and (${advancedWhere}) order by ${client.unsafe(order.join(', '))} limit ${pageSize + 1} offset ${offset}`;
  return { page, pageSize, rows: rows.slice(0, pageSize), total: rows[0]?.total_count ?? 0, hasNext: rows.length > pageSize };
}

export async function adminUnreadCount() {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  const [row] = await client<{ count: number }[]>`select count(*)::int count from idoc.support_conversations c
    join idoc.support_conversation_administrators ca on ca.conversation_id=c.id and ca.administrator_user_id=${actor.id}
    left join idoc.support_administrator_read_cursors rc on rc.conversation_id=c.id and rc.administrator_user_id=${actor.id}
    where exists(select 1 from idoc.support_messages m where m.conversation_id=c.id and m.author_side='member'
      and (rc.read_at is null or m.created_at>rc.read_at))`;
  return row?.count ?? 0;
}

export async function getAdminConversation(value: unknown) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  const parsedPublicId = publicIdSchema.safeParse(value);
  if (!parsedPublicId.success) return null;
  const publicId = parsedPublicId.data;
  return client.begin(async (sql) => {
    const rows = await sql<AdminConversationRow[]>`select c.*,coalesce(p.first_name||' '||p.last_name,'') member_name,coalesce(u.email_display,u.email) member_email,
      coalesce((select array_agg(u2.email order by u2.email) from idoc.support_conversation_administrators ca
        join idoc.users u2 on u2.id=ca.administrator_user_id where ca.conversation_id=c.id),'{}') assigned_admin_keys
      from idoc.support_conversations c join idoc.users u on u.id=c.member_user_id left join idoc.profiles p on p.user_id=u.id where c.public_id=${publicId}::uuid for update`;
    if (!rows[0]) return null;
    await sql`insert into idoc.support_administrator_read_cursors(conversation_id,administrator_user_id,read_at)
      values(${rows[0].id},${actor.id},now()) on conflict(conversation_id,administrator_user_id) do update set read_at=excluded.read_at`;
    const messages = await sql`select author_side,body,created_at from idoc.support_messages where conversation_id=${rows[0].id} order by created_at,id`;
    return { ...rows[0], messages };
  });
}

export async function replyAsAdministrator(input: { body: unknown; idempotencyKey: unknown; publicId: unknown }) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor);
  const body = parse(messageSchema, input.body); const key = parse(keySchema, input.idempotencyKey); const publicId = parse(publicIdSchema, input.publicId);
  await client.begin(async (sql) => {
    const rows = await sql<{ id: number; status: string }[]>`select id,status from idoc.support_conversations where public_id=${publicId}::uuid for update`;
    if (!rows[0]) throw new SupportValidationError('Conversation not found.');
    if (rows[0].status === 'closed') throw new SupportValidationError('Reopen this conversation before replying.');
    const inserted = await sql`insert into idoc.support_messages (conversation_id,author_user_id,author_side,body,idempotency_key)
      values (${rows[0].id},${actor.id},'admin',${body},${key}::uuid) on conflict (author_user_id,idempotency_key) do nothing returning id`;
    if (inserted[0]) await sql`update idoc.support_conversations set status='admin_responded',updated_at=now(),admin_read_at=now() where id=${rows[0].id}`;
  });
}

export async function setConversationAssignment(publicIdValue: unknown, administratorValues: unknown[]) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor); const publicId = parse(publicIdSchema, publicIdValue);
  const values = [...new Set(administratorValues.filter((value): value is string => typeof value === 'string' && value !== ''))];
  const administratorIds = await Promise.all(values.map(resolveEligibleAdministrator));
  if (administratorIds.length === 0 || administratorIds.some((id) => id === null)) throw new SupportValidationError('Choose at least one eligible administrator.');
  await client.begin(async (sql) => {
    const rows = await sql<{ id: number }[]>`select id from idoc.support_conversations where public_id=${publicId}::uuid for update`;
    if (!rows[0]) throw new SupportValidationError('Conversation not found.');
    const before = await sql<{ administrator_user_id: number }[]>`select administrator_user_id from idoc.support_conversation_administrators where conversation_id=${rows[0].id} order by administrator_user_id`;
    await sql`delete from idoc.support_conversation_administrators where conversation_id=${rows[0].id}`;
    for (const administratorId of administratorIds) await sql`insert into idoc.support_conversation_administrators(conversation_id,administrator_user_id,assigned_by_user_id) values(${rows[0].id},${administratorId},${actor.id})`;
    await sql`update idoc.support_conversations set assigned_admin_user_id=${administratorIds[0] ?? null},updated_at=now() where id=${rows[0].id}`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json)
      values(${actor.id},'support.assignment.changed','support_conversation',${publicId},${JSON.stringify({ administratorIds: before.map((row) => row.administrator_user_id) })}::jsonb,${JSON.stringify({ administratorIds })}::jsonb)`;
  });
}

export async function setConversationClosed(publicIdValue: unknown, close: boolean) {
  const actor = await requireAccountAccess('administration'); requireAdministrator(actor); const publicId = parse(publicIdSchema, publicIdValue);
  await client.begin(async (sql) => {
    const rows = await sql<{ id: number; status: string }[]>`select id,status from idoc.support_conversations where public_id=${publicId}::uuid for update`;
    if (!rows[0]) throw new SupportValidationError('Conversation not found.');
    const latest = await sql<{ author_side: string }[]>`select author_side from idoc.support_messages where conversation_id=${rows[0].id} order by created_at desc,id desc limit 1`;
    const next = close ? 'closed' : latest[0]?.author_side === 'admin' ? 'admin_responded' : latest[0]?.author_side === 'member' ? 'member_replied' : 'open';
    if (rows[0].status === next) return;
    await sql`update idoc.support_conversations set status=${next},updated_at=now() where id=${rows[0].id}`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json)
      values(${actor.id},${close ? 'support.conversation.closed' : 'support.conversation.reopened'},'support_conversation',${publicId},${JSON.stringify({ status: rows[0].status })}::jsonb,${JSON.stringify({ status: next })}::jsonb)`;
  });
}

export async function listCategoryDefaults() {
  const actor = await requireAccountAccess('administration'); requireSuperAdmin(actor);
  return client`select d.category,u.email assignment_key from idoc.support_category_defaults d join idoc.users u on u.id=d.administrator_user_id`;
}

export async function setCategoryDefault(categoryValue: unknown, administratorValues: unknown[]) {
  const actor = await requireAccountAccess('administration'); requireSuperAdmin(actor); const category = parse(categorySchema, categoryValue);
  const values = [...new Set(administratorValues.filter((value): value is string => typeof value === 'string' && value !== ''))];
  const administratorIds = await Promise.all(values.map(resolveEligibleAdministrator));
  if (administratorIds.some((id) => id === null)) throw new SupportValidationError('Choose eligible administrators.');
  await client.begin(async (sql) => {
    const current = await sql<{ administrator_user_id: number }[]>`select administrator_user_id from idoc.support_category_defaults where category=${category} for update`;
    const currentIds = current.map((row) => row.administrator_user_id).sort((a, b) => a - b);
    const nextIds = administratorIds.filter((id): id is number => id !== null).sort((a, b) => a - b);
    if (currentIds.length === nextIds.length && currentIds.every((id, index) => id === nextIds[index])) return;
    await sql`delete from idoc.support_category_defaults where category=${category}`;
    for (const administratorId of nextIds) await sql`insert into idoc.support_category_defaults(category,administrator_user_id,updated_by,updated_at) values(${category},${administratorId},${actor.id},now())`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json)
      values(${actor.id},'support.category_default.changed','support_category_default',${category},${JSON.stringify({ administratorIds: current.map((row) => row.administrator_user_id) })}::jsonb,${JSON.stringify({ administratorIds })}::jsonb)`;
  });
}
