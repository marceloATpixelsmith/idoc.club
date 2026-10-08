import 'server-only';

import { z } from 'zod';
import { client } from '@/lib/db/drizzle';
import { getAccountStateUser } from '@/lib/db/queries';
import { advancedListWhere, listDate, listOrder, listPage, listPageSize, many } from '@/lib/admin/resource-list-query';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { testBoundaryActor } from '@/lib/membership/test-boundary';
import { requireAdministrator } from '@/lib/membership/authorization';
import { hasVisibleContent, sanitizeArticleContent } from '@/lib/news/sanitize';

/** Every scheduled-publication comparison in this module uses `now()` evaluated by PostgreSQL, which
 * always returns an absolute UTC instant for a `timestamp with time zone` column regardless of the
 * database server's local timezone setting -- this is the "one documented timezone" the publication
 * pipeline uses. Administrators enter the publication date/time as UTC in the admin form (labeled
 * accordingly); nothing here interprets it in the administrator's local browser timezone. */
export const NEWS_STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];
export const NEWS_TYPES = ['news', 'blog'] as const;
export type NewsType = (typeof NEWS_TYPES)[number];
export const NEWS_TYPE_LABELS: Record<NewsType, string> = { news: 'NEWS', blog: 'BLOG' };
export const NEWS_AUDIENCES = ['public', 'members', 'judge', 'steward', 'veterinarian'] as const;
export type NewsAudience = (typeof NEWS_AUDIENCES)[number];

export const STATUS_LABELS: Record<NewsStatus, string> = {
  archived: 'Archived', draft: 'Draft', published: 'Published', scheduled: 'Scheduled',
};

export const NEWS_TITLE_MAX_LENGTH = 200;
export const NEWS_SUBTITLE_MAX_LENGTH = 300;
export const NEWS_SLUG_MAX_LENGTH = 160;
export const NEWS_CONTENT_MAX_LENGTH = 20_000;
const PUBLIC_PAGE_SIZE = 10;

export class NewsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NewsValidationError';
  }
}

const titleSchema = z.string().trim().min(1).max(NEWS_TITLE_MAX_LENGTH);
const subtitleSchema = z.string().trim().max(NEWS_SUBTITLE_MAX_LENGTH).nullable();
const contentSchema = z.string().max(NEWS_CONTENT_MAX_LENGTH);
const slugSchema = z.string().trim().toLowerCase().min(1).max(NEWS_SLUG_MAX_LENGTH).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const statusSchema = z.enum(NEWS_STATUSES);
const typeSchema = z.enum(NEWS_TYPES);
const audienceValueSchema = z.enum(NEWS_AUDIENCES);
const thumbnailUrlSchema = z.string().trim().url().max(2000).nullable();
const externalUrlSchema = z.string().trim().url().max(2000).refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
const idSchema = z.coerce.number().int().positive();
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a publication date in YYYY-MM-DD format.').refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, 'Invalid date');

/** The admin publication-date field is a date-only input (YYYY-MM-DD) in UTC,
 * which is normalized to midnight UTC. Treating
 * that string as UTC -- rather than letting `Date.parse` fall back to the server process's local
 * timezone, which is unspecified and must never silently vary the scheduled-publication clock -- is
 * the "one documented timezone" this module evaluates every scheduled transition in. A value that
 * already carries an explicit offset or `Z` (e.g. from a test fixture) is left untouched. */
function parseAsUtc(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

/** Every timestamptz value bound into a query in this module goes through this helper -- passing a
 * raw JS Date object as a tagged-template parameter through the Proxy-wrapped `client` export
 * (lib/db/drizzle.ts) does not reliably serialize the same way a plain postgres.js client does, so
 * values are always converted to an explicit ISO-8601 string first (PostgreSQL parses timestamptz
 * from ISO-8601 text natively regardless of the column's own stored representation). */
function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, message = 'Review the article fields.'): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new NewsValidationError(message);
  return result.data;
}

function slugify(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, NEWS_SLUG_MAX_LENGTH).replace(/-+$/g, '') || 'article';
}


const LEGACY_BLOG_SLUGS = [
  'modern-dressage-judging',
  'modern-dressage-judging-perception-data-and-the-evolving-role-of-welfareby-hans-christian-matthiesen',
  'stress-in-dressage-horses',
  'new-research-on-stress-in-dressage-horses',
  'integrity-beyond-compliance',
] as const;

async function newsSchemaSupportsTypeAndThumbnail(): Promise<boolean> {
  const [row] = await client<{ ready: boolean }[]>`
    select (
      exists(select 1 from information_schema.columns where table_schema='idoc' and table_name='news_articles' and column_name='article_type')
      and exists(select 1 from information_schema.columns where table_schema='idoc' and table_name='news_articles' and column_name='thumbnail_url')
    ) as ready`;
  return Boolean(row?.ready);
}

async function newsSchemaSupportsAudience(): Promise<boolean> {
  const [row] = await client<{ ready: boolean }[]>`
    select exists(
      select 1 from information_schema.columns
      where table_schema='idoc' and table_name='news_articles' and column_name='audience'
    ) as ready`;
  return Boolean(row?.ready);
}

async function newsSchemaSupportsExternalUrl(): Promise<boolean> {
  const [row] = await client<{ ready: boolean }[]>`
    select exists(
      select 1 from information_schema.columns
      where table_schema='idoc' and table_name='news_articles' and column_name='external_url'
    ) as ready`;
  return Boolean(row?.ready);
}

export async function requireNewsArticleSchema() {
  if ((await newsSchemaSupportsTypeAndThumbnail()) && (await newsSchemaSupportsExternalUrl()) && (await newsSchemaSupportsAudience())) return;

  try {
    await client.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext('idoc.news_articles.schema'))`;

      await sql`alter table idoc.news_articles
        add column if not exists article_type varchar(10) not null default 'news'`;
      await sql`alter table idoc.news_articles
        add column if not exists thumbnail_url text`;
      await sql`create index if not exists news_articles_type_publication_idx
        on idoc.news_articles (article_type, status, publication_date)`;

      await sql`alter table idoc.news_articles drop constraint if exists news_articles_type_check`;
      await sql`alter table idoc.news_articles
        add constraint news_articles_type_check check (article_type in ('news', 'blog'))`;

      await sql`update idoc.news_articles
        set article_type = 'blog'
        where lower(title) in (
          'modern dressage judging: perception, data, and the evolving role of welfare',
          'new research on stress in dressage horses',
          'integrity beyond compliance'
        )
        or slug in (
          'modern-dressage-judging',
          'modern-dressage-judging-perception-data-and-the-evolving-role-of-welfareby-hans-christian-matthiesen',
          'stress-in-dressage-horses',
          'new-research-on-stress-in-dressage-horses',
          'integrity-beyond-compliance'
        )`;

      await sql`alter table idoc.news_articles add column if not exists external_url text`;
      await sql`alter table idoc.news_articles
        add column if not exists audience varchar(20)[] not null default array['public']::varchar[]`;
      await sql`alter table idoc.news_articles drop constraint if exists news_articles_audience_check`;
      await sql`alter table idoc.news_articles
        add constraint news_articles_audience_check check (
          cardinality(audience) between 1 and 3
          and audience <@ array['public','members','judge','steward','veterinarian']::varchar[]
          and (
            (audience && array['public','members']::varchar[] and cardinality(audience)=1)
            or
            (not (audience && array['public','members']::varchar[]) and audience <@ array['judge','steward','veterinarian']::varchar[])
          )
        )`;
      await sql`alter table idoc.news_articles drop constraint if exists news_articles_external_url_check`;
      await sql`alter table idoc.news_articles
        add constraint news_articles_external_url_check
        check (external_url is null or external_url ~* '^https?://')`;
      await sql`alter table idoc.news_articles drop constraint if exists news_articles_content_length_check`;
      await sql`alter table idoc.news_articles
        add constraint news_articles_content_length_check
        check (
          (external_url is null and char_length(content_html) between 1 and 20000)
          or
          (external_url is not null and char_length(content_html) between 0 and 20000)
        )`;
    });
  } catch (error) {
    console.error('news_article_schema_upgrade_failed', error);
    throw new NewsValidationError('News/Blog database preparation failed. Please retry the save or contact an administrator.');
  }

  if (!(await newsSchemaSupportsTypeAndThumbnail()) || !(await newsSchemaSupportsExternalUrl()) || !(await newsSchemaSupportsAudience())) {
    throw new NewsValidationError('News/Blog database preparation did not complete. Please retry the save or contact an administrator.');
  }
}

function legacyArticleTypeSql() {
  return client`case
    when lower(title) in (
      'modern dressage judging: perception, data, and the evolving role of welfare',
      'new research on stress in dressage horses',
      'integrity beyond compliance'
    ) or slug in ${client([...LEGACY_BLOG_SLUGS])}
    then 'blog' else 'news' end`;
}

function legacyThumbnailSql() {
  return client`case
    when lower(title) like '%jacques van daele%' or slug in ('in-memoriam-jacques-van-daele','in-memoriam-jacques-van-daele-1953-2026')
      then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989373/jacques-van-daele.jpg'
    when lower(title) like '%stephen clarke%' or slug in ('in-memoriam-stephen-clarke','in-memoriam-stephen-clarke-1952-2026')
      then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989376/stephen-clarke.jpg'
    when lower(title) like '%judging guidelines%' or slug in ('fei-judging-guidelines','how-to-apply-the-fei-judging-guidelines-on-tension-submission-acceptance-of-the-contact-and-harmony')
      then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989380/fei-judging-guidelines.jpg'
    when lower(title) = 'fei rules revision' or slug = 'fei-rules-revision'
      then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989383/fei-rules-revision.jpg'
    when lower(title) like 'modern dressage judging:%' or slug in ('modern-dressage-judging','modern-dressage-judging-perception-data-and-the-evolving-role-of-welfareby-hans-christian-matthiesen')
      then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989387/modern-dressage-judging.jpg'
    when lower(title) = 'new research on stress in dressage horses' or slug in ('stress-in-dressage-horses','new-research-on-stress-in-dressage-horses')
      then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989391/stress-in-dressage-horses.jpg'
    when lower(title) = 'integrity beyond compliance' or slug = 'integrity-beyond-compliance'
      then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989394/integrity-beyond-compliance.jpg'
    else null end`;
}

async function requireNewsAdministrator() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return actor;
}

type ArticleInput = { articleType: unknown; audience: unknown; contentHtml: unknown; externalUrl: unknown; publicationDate: unknown; slug: unknown; status: unknown; subtitle: unknown; thumbnailUrl: unknown; title: unknown };

function validateFields(input: ArticleInput) {
  const title = parse(titleSchema, input.title, 'Title is required and must be 200 characters or fewer.');
  const articleType = parse(typeSchema, input.articleType, 'Choose NEWS or BLOG.');
  const audienceInput = Array.isArray(input.audience) ? input.audience : [input.audience];
  const audience = [...new Set(audienceInput.map((value) => String(value)).filter(Boolean))]
    .map((value) => parse(audienceValueSchema, value, 'Choose a valid member access option.'));
  if (!audience.length) throw new NewsValidationError('Choose who can access this article.');
  const broadAudience = audience.filter((value) => value === 'public' || value === 'members');
  if ((broadAudience.length > 0 && audience.length !== 1) || audience.length > 3) {
    throw new NewsValidationError('Public and All logged-in Members cannot be combined with other access options.');
  }
  const subtitleRaw = typeof input.subtitle === 'string' ? input.subtitle.trim() : '';
  const subtitle = subtitleRaw ? parse(subtitleSchema, subtitleRaw, 'Subtitle must be 300 characters or fewer.') : null;
  const externalRaw = typeof input.externalUrl === 'string' ? input.externalUrl.trim() : '';
  const externalUrl = externalRaw ? parse(externalUrlSchema, externalRaw, 'External link must be a valid http:// or https:// URL.') : null;
  const rawContent = typeof input.contentHtml === 'string' ? input.contentHtml : '';
  const sanitizedContent = sanitizeArticleContent(rawContent);
  if (!externalUrl && !hasVisibleContent(sanitizedContent)) throw new NewsValidationError('Article content is required when no external link is provided.');
  const contentHtml = parse(contentSchema, sanitizedContent, 'Article content must be 20,000 characters or fewer.');
  const status = parse(statusSchema, input.status, 'Choose a valid publication status.');
  const publicationDateIso = parse(isoDateSchema, input.publicationDate, 'Enter a valid publication date.');
  const publicationDate = parseAsUtc(`${publicationDateIso}T00:00:00.000`);
  if (status === 'scheduled' && publicationDate.getTime() <= Date.now()) {
    throw new NewsValidationError('Scheduled articles require a publication date in the future.');
  }
  const slugInput = typeof input.slug === 'string' ? input.slug.trim() : '';
  const slug = parse(slugSchema, slugInput || slugify(title), 'Slug must use lowercase letters, numbers, and hyphens only.');
  const thumbnailRaw = typeof input.thumbnailUrl === 'string' ? input.thumbnailUrl.trim() : '';
  const thumbnailUrl = thumbnailRaw ? parse(thumbnailUrlSchema, thumbnailRaw, 'Thumbnail URL is invalid.') : null;
  return { articleType, audience, contentHtml, externalUrl, publicationDate, slug, status, subtitle, thumbnailUrl, title };
}

export async function listAdminArticles(input: Record<string, string | string[] | undefined>) {
  await requireNewsAdministrator();
  const firstValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const page = listPage(input);
  const statuses = many(input.status).filter((value): value is NewsStatus => NEWS_STATUSES.includes(value as NewsStatus));
  const statusWhere = statuses.length ? client`status in ${client(statuses)}` : client`true`;
  const types = many(input.type).filter((value): value is NewsType => NEWS_TYPES.includes(value as NewsType));
  const schemaReady = await newsSchemaSupportsTypeAndThumbnail();
  const externalReady = await newsSchemaSupportsExternalUrl();
  const audienceReady = await newsSchemaSupportsAudience();
  const search = (firstValue(input.q) ?? '').trim().slice(0, 100);
  const fromValue = firstValue(input.from) ?? '';
  const toValue = firstValue(input.to) ?? '';
  const from = listDate(fromValue);
  const to = listDate(toValue);
  const order = listOrder(input, { publication: 'publication_date', title: 'title', status: 'status', type: 'article_type', updated: 'updated_at' }, 'publication');
  const advancedWhere = advancedListWhere(input, { title: 'title', status: 'status' }, NEWS_STATUSES);
  const limit = listPageSize(input);
  const offset = (page - 1) * limit;
  const rows = schemaReady
    ? await client`select id,slug,title,subtitle,article_type,${audienceReady ? client`audience` : client`array['public']::varchar[]`} as audience,thumbnail_url,${externalReady ? client`external_url` : client`null::text`} as external_url,status,publication_date,published_at,updated_at,count(*) over()::int total_count from idoc.news_articles
        where (${statusWhere}) and (${types.length ? client`article_type in ${client(types)}` : client`true`})
        and (${search}='' or title ilike ${`%${search}%`} or subtitle ilike ${`%${search}%`} or slug ilike ${`%${search}%`})
        and (${from}::date is null or publication_date>=${from}::date) and (${to}::date is null or publication_date<(${to}::date + interval '1 day')) and (${advancedWhere})
        order by ${order} limit ${limit + 1} offset ${offset}`
    : await client`select id,slug,title,subtitle,${legacyArticleTypeSql()} as article_type,array['public']::varchar[] as audience,${legacyThumbnailSql()} as thumbnail_url,null::text as external_url,status,publication_date,published_at,updated_at,count(*) over()::int total_count
        from idoc.news_articles
        where (${statusWhere})
        and (${types.length ? client`${legacyArticleTypeSql()} in ${client(types)}` : client`true`})
        and (${search}='' or title ilike ${`%${search}%`} or subtitle ilike ${`%${search}%`} or slug ilike ${`%${search}%`})
        and (${from}::date is null or publication_date>=${from}::date) and (${to}::date is null or publication_date<(${to}::date + interval '1 day')) and (${advancedWhere})
        order by ${order} limit ${limit + 1} offset ${offset}`;
  return { hasNext: rows.length > limit, page, pageSize: limit, rows: rows.slice(0, limit), total: Number(rows[0]?.total_count ?? 0) };
}

export async function getAdminArticle(value: unknown) {
  await requireNewsAdministrator();
  const parsedId = idSchema.safeParse(value);
  if (!parsedId.success) return null;
  const schemaReady = await newsSchemaSupportsTypeAndThumbnail();
  const externalReady = await newsSchemaSupportsExternalUrl();
  const [row] = schemaReady
    ? externalReady
      ? await client`select *,coalesce(thumbnail_url,${legacyThumbnailSql()}) as admin_thumbnail_url from idoc.news_articles where id=${parsedId.data} limit 1`
      : await client`select *,coalesce(thumbnail_url,${legacyThumbnailSql()}) as admin_thumbnail_url,null::text as external_url from idoc.news_articles where id=${parsedId.data} limit 1`
    : await client`select *,${legacyArticleTypeSql()} as article_type,${legacyThumbnailSql()} as thumbnail_url,null::text as external_url from idoc.news_articles where id=${parsedId.data} limit 1`;
  if (!row) return null;
  if (schemaReady) {
    return { ...row, thumbnail_url: row.admin_thumbnail_url ?? row.thumbnail_url };
  }
  return row;
}

export async function createArticle(input: ArticleInput) {
  const actor = await requireNewsAdministrator();
  await requireNewsArticleSchema();
  const fields = validateFields(input);
  return client.begin(async (sql) => {
    const slugTaken = await sql<{ id: number }[]>`select id from idoc.news_articles where slug=${fields.slug} limit 1`;
    if (slugTaken[0]) throw new NewsValidationError('That slug is already in use by another article.');
    const publishedAt = fields.status === 'published' ? new Date() : null;
    const [row] = await sql<{ id: number }[]>`insert into idoc.news_articles
      (slug,title,subtitle,article_type,audience,thumbnail_url,external_url,content_html,status,publication_date,published_at,created_by_user_id,updated_by_user_id)
      values (${fields.slug},${fields.title},${fields.subtitle},${fields.articleType},${fields.audience},${fields.thumbnailUrl},${fields.externalUrl},${fields.contentHtml},${fields.status},${iso(fields.publicationDate)},${iso(publishedAt)},${actor.id},${actor.id})
      returning id`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values
      (${actor.id},'admin.news_article.created','news_article',${String(row.id)},${JSON.stringify({ audience: fields.audience, slug: fields.slug, status: fields.status, title: fields.title })}::jsonb)`;
    return row.id;
  });
}

export async function updateArticle(idValue: unknown, input: ArticleInput) {
  const actor = await requireNewsAdministrator();
  await requireNewsArticleSchema();
  const id = parse(idSchema, idValue, 'Article not found.');
  const fields = validateFields(input);
  await client.begin(async (sql) => {
    const [existing] = await sql<{
      audience: string[]; published_at: Date | string | null; slug: string; status: NewsStatus; title: string;
    }[]>`select audience,slug,status,title,published_at from idoc.news_articles where id=${id} for update`;
    if (!existing) throw new NewsValidationError('Article not found.');
    const slugTaken = await sql<{ id: number }[]>`select id from idoc.news_articles where slug=${fields.slug} and id<>${id} limit 1`;
    if (slugTaken[0]) throw new NewsValidationError('That slug is already in use by another article.');
    const publishedAt = fields.status === 'published' ? (existing.published_at ?? new Date()) : null;
    await sql`update idoc.news_articles set slug=${fields.slug},title=${fields.title},subtitle=${fields.subtitle},
      article_type=${fields.articleType},audience=${fields.audience},thumbnail_url=${fields.thumbnailUrl},external_url=${fields.externalUrl},content_html=${fields.contentHtml},status=${fields.status},publication_date=${iso(fields.publicationDate)},
      published_at=${iso(publishedAt)},updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    const audienceChanged = JSON.stringify(existing.audience) !== JSON.stringify(fields.audience);
    const changedFields = [
      audienceChanged && 'audience', existing.slug !== fields.slug && 'slug',
      existing.title !== fields.title && 'title', existing.status !== fields.status && 'status',
    ].filter(Boolean);
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
      (${actor.id},'admin.news_article.edited','news_article',${String(id)},
      ${JSON.stringify({ audience: existing.audience, slug: existing.slug, status: existing.status, title: existing.title })}::jsonb,
      ${JSON.stringify({ audience: fields.audience, changedFields, slug: fields.slug, status: fields.status, title: fields.title })}::jsonb)`;
  });
}

export async function publishArticle(idValue: unknown) {
  const actor = await requireNewsAdministrator();
  const id = parse(idSchema, idValue, 'Article not found.');
  await client.begin(async (sql) => {
    const [existing] = await sql<{ publication_date: Date | string; status: NewsStatus }[]>`select status,publication_date from idoc.news_articles where id=${id} for update`;
    if (!existing) throw new NewsValidationError('Article not found.');
    const existingPublicationDate = new Date(existing.publication_date);
    const publicationDate = existingPublicationDate.getTime() > Date.now() ? new Date() : existingPublicationDate;
    await sql`update idoc.news_articles set status='published',publication_date=${iso(publicationDate)},published_at=now(),
      updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
      (${actor.id},'admin.news_article.published','news_article',${String(id)},${JSON.stringify({ status: existing.status })}::jsonb,${JSON.stringify({ trigger: 'manual' })}::jsonb)`;
  });
}

export async function unpublishArticle(idValue: unknown) {
  const actor = await requireNewsAdministrator();
  const id = parse(idSchema, idValue, 'Article not found.');
  await client.begin(async (sql) => {
    const [existing] = await sql<{ status: NewsStatus }[]>`select status from idoc.news_articles where id=${id} for update`;
    if (!existing) throw new NewsValidationError('Article not found.');
    if (existing.status !== 'published') throw new NewsValidationError('Only a published article can be unpublished.');
    await sql`update idoc.news_articles set status='draft',published_at=null,updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json) values
      (${actor.id},'admin.news_article.unpublished','news_article',${String(id)},${JSON.stringify({ status: existing.status })}::jsonb)`;
  });
}

export async function scheduleArticle(idValue: unknown, publicationDateValue: unknown) {
  const actor = await requireNewsAdministrator();
  const id = parse(idSchema, idValue, 'Article not found.');
  const publicationDateIso = parse(isoDateSchema, publicationDateValue, 'Enter a valid publication date.');
  const publicationDate = parseAsUtc(`${publicationDateIso}T00:00:00.000`);
  if (publicationDate.getTime() <= Date.now()) throw new NewsValidationError('Scheduled articles require a publication date in the future.');
  await client.begin(async (sql) => {
    const [existing] = await sql<{ status: NewsStatus }[]>`select status from idoc.news_articles where id=${id} for update`;
    if (!existing) throw new NewsValidationError('Article not found.');
    await sql`update idoc.news_articles set status='scheduled',publication_date=${iso(publicationDate)},published_at=null,
      updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
      (${actor.id},'admin.news_article.scheduled','news_article',${String(id)},${JSON.stringify({ status: existing.status })}::jsonb,${JSON.stringify({ publicationDate: publicationDate.toISOString() })}::jsonb)`;
  });
}

export async function archiveArticle(idValue: unknown) {
  const actor = await requireNewsAdministrator();
  const id = parse(idSchema, idValue, 'Article not found.');
  await client.begin(async (sql) => {
    const [existing] = await sql<{ status: NewsStatus }[]>`select status from idoc.news_articles where id=${id} for update`;
    if (!existing) throw new NewsValidationError('Article not found.');
    if (existing.status === 'archived') return;
    await sql`update idoc.news_articles set status='archived',archived_at=now(),updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json) values
      (${actor.id},'admin.news_article.archived','news_article',${String(id)},${JSON.stringify({ status: existing.status })}::jsonb)`;
  });
}

export async function deleteArticle(idValue: unknown) {
  const actor = await requireNewsAdministrator();
  const id = parse(idSchema, idValue, 'Article not found.');
  await client.begin(async (sql) => {
    const [existing] = await sql<{ slug: string; status: NewsStatus; title: string }[]>`select slug,status,title from idoc.news_articles where id=${id} for update`;
    if (!existing) throw new NewsValidationError('Article not found.');
    if (existing.status !== 'draft' && existing.status !== 'archived') {
      throw new NewsValidationError('Archive a published or scheduled article before deleting it.');
    }
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json) values
      (${actor.id},'admin.news_article.deleted','news_article',${String(id)},${JSON.stringify({ slug: existing.slug, status: existing.status, title: existing.title })}::jsonb)`;
    await sql`delete from idoc.news_articles where id=${id}`;
  });
}


export async function deleteArticles(idValues: unknown[]) {
  const actor = await requireNewsAdministrator();
  const ids = [...new Set(idValues.map((value) => parse(idSchema, value, 'Article not found.')))];
  if (!ids.length) throw new NewsValidationError('Select at least one article.');

  await client.begin(async (sql) => {
    const rows = await sql<{ id: number; slug: string; status: NewsStatus; title: string }[]>`
      select id,slug,status,title
      from idoc.news_articles
      where id in ${sql(ids)}
      for update`;

    if (rows.length !== ids.length) {
      throw new NewsValidationError('One or more selected articles no longer exist.');
    }

    const blocked = rows.find((row) => row.status !== 'draft' && row.status !== 'archived');
    if (blocked) {
      throw new NewsValidationError('Archive every published or scheduled article before deleting the selection.');
    }

    for (const row of rows) {
      await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json) values
        (${actor.id},'admin.news_article.deleted','news_article',${String(row.id)},${JSON.stringify({ slug: row.slug, status: row.status, title: row.title })}::jsonb)`;
    }

    await sql`delete from idoc.news_articles where id in ${sql(ids)}`;
  });
}

/** Vercel Cron entry point (see app/api/cron/news-scheduled-publish/route.ts): transitions every
 * 'scheduled' article whose UTC publication calendar date has arrived to 'published'.
 * Any legacy time-of-day is normalized to midnight UTC during the transition. */
export async function publishScheduledArticles(): Promise<{ published: number }> {
  return client.begin(async (sql) => {
    const rows = await sql<{ id: number }[]>`select id from idoc.news_articles where status='scheduled' and (publication_date at time zone 'UTC')::date <= (now() at time zone 'UTC')::date for update skip locked`;
    for (const row of rows) {
      await sql`update idoc.news_articles set status='published',publication_date=((publication_date at time zone 'UTC')::date::timestamp at time zone 'UTC'),published_at=now(),updated_at=now() where id=${row.id}`;
      await sql`insert into idoc.audit_log(action,entity_type,entity_id,after_json) values
        ('admin.news_article.published','news_article',${String(row.id)},${JSON.stringify({ trigger: 'scheduled_publish_cron' })}::jsonb)`;
    }
    return { published: rows.length };
  });
}

type ArticleViewer = { loggedInMember: boolean; roles: string[] };

async function currentArticleViewer(): Promise<ArticleViewer> {
  const injectedActor = testBoundaryActor();
  // Direct integration-test calls have no Next.js request store. Treat them as anonymous unless
  // the isolated membership test boundary explicitly injects an authenticated actor.
  if (process.env.NODE_ENV === 'test' && !injectedActor) {
    return { loggedInMember: false, roles: [] };
  }
  const user = injectedActor ?? await getAccountStateUser();
  if (!user) return { loggedInMember: false, roles: [] };

  const [profile] = await client<{ id: number }[]>`
    select id from idoc.profiles where user_id=${user.id} limit 1`;
  if (!profile) return { loggedInMember: false, roles: [] };

  const [membership, roles] = await Promise.all([
    client<{ grace_ends_on: string | null; status: string; valid_until: string }[]>`
      select grace_ends_on,status,valid_until
      from idoc.memberships
      where profile_id=${profile.id}
      order by valid_until desc,id desc
      limit 1`,
    client<{ role_type: string }[]>`
      select role_type
      from idoc.professional_roles
      where profile_id=${profile.id} and effective_to is null`,
  ]);
  const loggedInMember = isEntitled(membership[0] ? {
    graceEndsOn: membership[0].grace_ends_on,
    status: membership[0].status,
    validUntil: membership[0].valid_until,
  } : null, new Date().toISOString().slice(0, 10));
  return { loggedInMember, roles: loggedInMember ? roles.map(({ role_type }) => role_type) : [] };
}

function articleAudienceWhere(viewer: ArticleViewer) {
  const judge = viewer.roles.includes('judge');
  const steward = viewer.roles.includes('steward');
  const veterinarian = viewer.roles.includes('veterinarian');
  return client`(
    'public'=any(audience)
    or (${viewer.loggedInMember} and 'members'=any(audience))
    or (${judge} and 'judge'=any(audience))
    or (${steward} and 'steward'=any(audience))
    or (${veterinarian} and 'veterinarian'=any(audience))
  )`;
}

export async function listPublicArticles(pageValue: unknown, typeValue?: unknown) {
  const page = Math.max(1, Number.parseInt(typeof pageValue === 'string' ? pageValue : '1', 10) || 1);
  const parsedType = typeSchema.safeParse(typeValue);
  const articleType = parsedType.success ? parsedType.data : null;
  const limit = PUBLIC_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const schemaReady = await newsSchemaSupportsTypeAndThumbnail();
  const externalReady = await newsSchemaSupportsExternalUrl();
  const audienceReady = await newsSchemaSupportsAudience();
  const viewer = audienceReady ? await currentArticleViewer() : { loggedInMember: false, roles: [] };
  const rows = schemaReady
    ? audienceReady
      ? await client`select slug,title,subtitle,article_type,audience,coalesce(thumbnail_url,${legacyThumbnailSql()}) as thumbnail_url,${externalReady ? client`external_url` : client`null::text`} as external_url,publication_date from idoc.news_articles
          where status='published' and publication_date<=now() and (${articleType}::text is null or article_type=${articleType})
          and (${articleAudienceWhere(viewer)})
          order by publication_date desc limit ${limit + 1} offset ${offset}`
      : await client`select slug,title,subtitle,article_type,array['public']::varchar[] as audience,coalesce(thumbnail_url,${legacyThumbnailSql()}) as thumbnail_url,${externalReady ? client`external_url` : client`null::text`} as external_url,publication_date from idoc.news_articles
          where status='published' and publication_date<=now() and (${articleType}::text is null or article_type=${articleType})
          order by publication_date desc limit ${limit + 1} offset ${offset}`
    : await client`select slug,title,subtitle,${legacyArticleTypeSql()} as article_type,array['public']::varchar[] as audience,${legacyThumbnailSql()} as thumbnail_url,null::text as external_url,publication_date
        from idoc.news_articles
        where status='published' and publication_date<=now()
        and (${articleType}::text is null or ${legacyArticleTypeSql()}=${articleType})
        order by publication_date desc limit ${limit + 1} offset ${offset}`;
  return { hasNext: rows.length > limit, page, rows: rows.slice(0, limit) };
}

export async function listAllPublicArticles(typeValue?: unknown) {
  const parsedType = typeSchema.safeParse(typeValue);
  const articleType = parsedType.success ? parsedType.data : null;
  const schemaReady = await newsSchemaSupportsTypeAndThumbnail();
  const externalReady = await newsSchemaSupportsExternalUrl();
  const audienceReady = await newsSchemaSupportsAudience();
  const viewer = audienceReady ? await currentArticleViewer() : { loggedInMember: false, roles: [] };
  return schemaReady
    ? audienceReady
      ? client`select slug,title,subtitle,article_type,audience,coalesce(thumbnail_url,${legacyThumbnailSql()}) as thumbnail_url,${externalReady ? client`external_url` : client`null::text`} as external_url,publication_date from idoc.news_articles
          where status='published' and publication_date<=now() and (${articleType}::text is null or article_type=${articleType})
          and (${articleAudienceWhere(viewer)})
          order by publication_date desc`
      : client`select slug,title,subtitle,article_type,array['public']::varchar[] as audience,coalesce(thumbnail_url,${legacyThumbnailSql()}) as thumbnail_url,${externalReady ? client`external_url` : client`null::text`} as external_url,publication_date from idoc.news_articles
          where status='published' and publication_date<=now() and (${articleType}::text is null or article_type=${articleType})
          order by publication_date desc`
    : client`select slug,title,subtitle,${legacyArticleTypeSql()} as article_type,array['public']::varchar[] as audience,${legacyThumbnailSql()} as thumbnail_url,null::text as external_url,publication_date
        from idoc.news_articles
        where status='published' and publication_date<=now()
        and (${articleType}::text is null or ${legacyArticleTypeSql()}=${articleType})
        order by publication_date desc`;
}

export async function getPublicArticleBySlug(value: unknown, expectedType?: NewsType) {
  const parsedSlug = slugSchema.safeParse(value);
  if (!parsedSlug.success) return null;
  const schemaReady = await newsSchemaSupportsTypeAndThumbnail();
  const externalReady = await newsSchemaSupportsExternalUrl();
  const audienceReady = await newsSchemaSupportsAudience();
  const viewer = audienceReady ? await currentArticleViewer() : { loggedInMember: false, roles: [] };
  const [row] = schemaReady
    ? audienceReady
      ? await client`select slug,title,subtitle,article_type,audience,coalesce(thumbnail_url,${legacyThumbnailSql()}) as thumbnail_url,${externalReady ? client`external_url` : client`null::text`} as external_url,content_html,publication_date from idoc.news_articles
          where slug=${parsedSlug.data} and status='published' and publication_date<=now()
          and (${expectedType ?? null}::text is null or article_type=${expectedType ?? null})
          and (${articleAudienceWhere(viewer)}) limit 1`
      : await client`select slug,title,subtitle,article_type,array['public']::varchar[] as audience,coalesce(thumbnail_url,${legacyThumbnailSql()}) as thumbnail_url,${externalReady ? client`external_url` : client`null::text`} as external_url,content_html,publication_date from idoc.news_articles
          where slug=${parsedSlug.data} and status='published' and publication_date<=now()
          and (${expectedType ?? null}::text is null or article_type=${expectedType ?? null}) limit 1`
    : await client`select slug,title,subtitle,${legacyArticleTypeSql()} as article_type,array['public']::varchar[] as audience,${legacyThumbnailSql()} as thumbnail_url,null::text as external_url,content_html,publication_date
        from idoc.news_articles
        where slug=${parsedSlug.data} and status='published' and publication_date<=now()
        and (${expectedType ?? null}::text is null or ${legacyArticleTypeSql()}=${expectedType ?? null}) limit 1`;
  return row ?? null;
}
