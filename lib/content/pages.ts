import 'server-only';

import type { TransactionSql } from 'postgres';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { client } from '@/lib/db/drizzle';
import { advancedListWhere, listOrder, listPage, listPageSize, many } from '@/lib/admin/resource-list-query';
import { requireAdministrator } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { hasVisibleContent, sanitizeArticleContent } from '@/lib/news/sanitize';

export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const;
export const CONTENT_AUDIENCES = ['public', 'member', 'judge', 'steward', 'veterinarian'] as const;
export const CONTENT_STATUS_LABELS = { archived: 'Archived', draft: 'Draft', published: 'Published' } as const;
export class ContentPageValidationError extends Error { constructor(message: string) { super(message); this.name = 'ContentPageValidationError'; } }
const slugSchema = z.string().trim().toLowerCase().min(1).max(160).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const idSchema = z.coerce.number().int().positive();
const slugify = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160).replace(/-+$/g, '') || 'page';
async function admin() { const actor = await requireAccountAccess('administration'); requireAdministrator(actor); return actor; }
type Input = { audienceMode: unknown; audiences: unknown[]; contentHtml: unknown; publishAt: unknown; seoDescription: unknown; seoTitle: unknown; slug: unknown; status: unknown; summary: unknown; title: unknown };
function fields(input: Input) {
  const title = z.string().trim().min(1).max(200).parse(input.title);
  const contentHtml = sanitizeArticleContent(typeof input.contentHtml === 'string' ? input.contentHtml : '');
  if (!hasVisibleContent(contentHtml) || contentHtml.length > 20_000) throw new ContentPageValidationError('Page content is required and must be 20,000 characters or fewer.');
  const audiences = [...new Set(input.audiences)].map((value) => z.enum(CONTENT_AUDIENCES).parse(value));
  if (audiences.length === 0) throw new ContentPageValidationError('Select at least one audience.');
  const status = z.enum(CONTENT_STATUSES).parse(input.status);
  const publishAt = typeof input.publishAt === 'string' && input.publishAt ? new Date(`${input.publishAt}${/[zZ]|[+-]\d\d:\d\d$/.test(input.publishAt) ? '' : 'Z'}`) : null;
  if (publishAt && Number.isNaN(publishAt.getTime())) throw new ContentPageValidationError('Enter a valid publication date.');
  return { audienceMode: z.enum(['any', 'all']).parse(input.audienceMode), audiences, contentHtml, publishAt: publishAt?.toISOString() ?? null,
    seoDescription: z.string().trim().max(320).transform(v => v || null).parse(input.seoDescription), seoTitle: z.string().trim().max(200).transform(v => v || null).parse(input.seoTitle),
    slug: slugSchema.parse(typeof input.slug === 'string' && input.slug.trim() ? input.slug : slugify(title)), status,
    summary: z.string().trim().max(500).transform(v => v || null).parse(input.summary), title };
}
export async function listAdminContentPages(input: Record<string, string | string[] | undefined>) {
  await admin();
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';
  const page = listPage(input);
  const pageSize = listPageSize(input);
  const q = one(input.q).trim().slice(0, 100);
  const statuses = many(input.status).filter((value): value is typeof CONTENT_STATUSES[number] => CONTENT_STATUSES.includes(value as never));
  const statusWhere = statuses.length ? client`p.status in ${client(statuses)}` : client`true`;
  const audiences = many(input.audience).filter((value): value is typeof CONTENT_AUDIENCES[number] => CONTENT_AUDIENCES.includes(value as never));
  const audienceWhere = audiences.length
    ? client`exists(select 1 from idoc.content_page_audiences x where x.page_id=p.id and x.audience in ${client(audiences)})`
    : client`true`;
  const order = listOrder(input, { title: 'p.title', status: 'p.status', updated: 'p.updated_at' }, 'updated', 'p.id');
  const advancedWhere = advancedListWhere(input, { title: 'p.title', status: 'p.status' }, CONTENT_STATUSES);
  const offset = (page - 1) * pageSize;
  const rows = await client`select p.id,p.slug,p.title,p.status,p.updated_at,p.audience_mode,
    coalesce(string_agg(a.audience,',' order by a.audience),'') audiences,count(*) over()::int total_count
    from idoc.content_pages p left join idoc.content_page_audiences a on a.page_id=p.id
    where (${q}='' or p.title ilike ${`%${q}%`} or p.slug ilike ${`%${q}%`})
    and (${statusWhere})
    and (${audienceWhere})
    and (${advancedWhere}) group by p.id
    order by ${order} limit ${pageSize + 1} offset ${offset}`;
  return { hasNext: rows.length > pageSize, page, pageSize, rows: rows.slice(0, pageSize), total: Number(rows[0]?.total_count ?? 0) };
}
export async function getAdminContentPage(value: unknown) { await admin(); const id = idSchema.safeParse(value); if (!id.success) return null; const [page] = await client`select p.*,coalesce(array_agg(a.audience) filter(where a.audience is not null),'{}') audiences from idoc.content_pages p left join idoc.content_page_audiences a on a.page_id=p.id where p.id=${id.data} group by p.id`; return page ?? null; }
async function revision(sql: TransactionSql<Record<string, never>>, id: number, actorId: number) { await sql`insert into idoc.content_page_revisions(page_id,revision_number,snapshot_json,created_by_user_id) select p.id,coalesce((select max(revision_number)+1 from idoc.content_page_revisions where page_id=p.id),1),jsonb_build_object('slug',p.slug,'title',p.title,'summary',p.summary,'contentHtml',p.content_html,'status',p.status,'audienceMode',p.audience_mode,'publishAt',p.publish_at,'seoTitle',p.seo_title,'seoDescription',p.seo_description,'audiences',(select jsonb_agg(audience order by audience) from idoc.content_page_audiences where page_id=p.id)),${actorId} from idoc.content_pages p where p.id=${id}`; }
export async function saveContentPage(idValue: unknown | null, input: Input) { const actor = await admin(); let validated; try { validated = fields(input); } catch (error) { if (error instanceof ContentPageValidationError) throw error; throw new ContentPageValidationError('Review the page fields and try again.'); } return client.begin(async sql => { const id = idValue ? idSchema.parse(idValue) : null; const duplicate = await sql`select id from idoc.content_pages where slug=${validated.slug} and (${id}::int is null or id<>${id}) limit 1`; if (duplicate[0]) throw new ContentPageValidationError('That slug is already in use.'); let pageId = id; if (id) { const existing = await sql`select id from idoc.content_pages where id=${id} for update`; if (!existing[0]) throw new ContentPageValidationError('Page not found.'); await sql`update idoc.content_pages set slug=${validated.slug},title=${validated.title},summary=${validated.summary},content_html=${validated.contentHtml},status=${validated.status},audience_mode=${validated.audienceMode},publish_at=${validated.publishAt},seo_title=${validated.seoTitle},seo_description=${validated.seoDescription},updated_by_user_id=${actor.id},updated_at=now() where id=${id}`; await sql`delete from idoc.content_page_audiences where page_id=${id}`; } else { const [row] = await sql<{id:number}[]>`insert into idoc.content_pages(slug,title,summary,content_html,status,audience_mode,publish_at,seo_title,seo_description,created_by_user_id,updated_by_user_id) values(${validated.slug},${validated.title},${validated.summary},${validated.contentHtml},${validated.status},${validated.audienceMode},${validated.publishAt},${validated.seoTitle},${validated.seoDescription},${actor.id},${actor.id}) returning id`; pageId = row.id; } for (const audience of validated.audiences) await sql`insert into idoc.content_page_audiences(page_id,audience) values(${pageId},${audience})`; await revision(sql, pageId as number, actor.id); await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values(${actor.id},${id ? 'admin.content_page.updated' : 'admin.content_page.created'},'content_page',${String(pageId)},${JSON.stringify({audiences: validated.audiences,slug:validated.slug,status:validated.status})}::jsonb)`; return pageId as number; }); }
export async function archiveContentPage(value: unknown) { const actor=await admin(); const id=idSchema.parse(value); await client.begin(async sql=>{ const rows=await sql`update idoc.content_pages set status='archived',updated_by_user_id=${actor.id},updated_at=now() where id=${id} returning id`; if(!rows[0]) throw new ContentPageValidationError('Page not found.'); await revision(sql,id,actor.id); await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id) values(${actor.id},'admin.content_page.archived','content_page',${String(id)})`; }); }
export async function deleteContentPage(value: unknown) { const actor=await admin(); const id=idSchema.parse(value); await client.begin(async sql=>{ const rows=await sql`select status from idoc.content_pages where id=${id} for update`; if(!rows[0]) throw new ContentPageValidationError('Page not found.'); if(!['draft','archived'].includes(String(rows[0].status))) throw new ContentPageValidationError('Archive a published page before deleting it.'); await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json) values(${actor.id},'admin.content_page.deleted','content_page',${String(id)},${JSON.stringify(rows[0])}::jsonb)`; await sql`delete from idoc.content_pages where id=${id}`; }); }
export async function getVisibleContentPage(value: unknown) { const slug=slugSchema.safeParse(value); if(!slug.success) return null; const session=await getSession(); const userId=session?.user.id ?? null; const [row]=await client`with actor as(select ${userId}::int user_id), facts as(select exists(select 1 from idoc.application_roles r,actor where r.user_id=actor.user_id and r.revoked_at is null and r.role in ('administrator','super_admin')) admin,exists(select 1 from (select m.status,m.valid_until,m.grace_ends_on from idoc.profiles pr join idoc.memberships m on m.profile_id=pr.id,actor where pr.user_id=actor.user_id order by m.valid_until desc limit 1) latest where ((latest.status in ('active','complimentary','canceled') and latest.valid_until>=current_date) or (latest.status='grace' and coalesce(latest.grace_ends_on,latest.valid_until)>=current_date))) member,array(select distinct role_type from idoc.professional_roles r join idoc.profiles pr on pr.id=r.profile_id,actor where pr.user_id=actor.user_id and r.effective_to is null) roles) select p.*,(select case when p.audience_mode='any' then bool_or(audience='public') else bool_and(audience='public') end from idoc.content_page_audiences where page_id=p.id) is_public from idoc.content_pages p,facts f where p.slug=${slug.data} and p.status='published' and (p.publish_at is null or p.publish_at<=now()) and (f.admin or (p.audience_mode='any' and exists(select 1 from idoc.content_page_audiences a where a.page_id=p.id and (a.audience='public' or (a.audience='member' and f.member) or (a.audience=any(f.roles) and f.member)))) or (p.audience_mode='all' and not exists(select 1 from idoc.content_page_audiences a where a.page_id=p.id and not (a.audience='public' or (a.audience='member' and f.member) or (a.audience=any(f.roles) and f.member))))) limit 1`; return row??null; }
