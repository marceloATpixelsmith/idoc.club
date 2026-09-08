import 'server-only';

import { z } from 'zod';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { hasVisibleContent, sanitizeArticleContent } from '@/lib/news/sanitize';

/** Every scheduled-publication comparison in this module uses `now()` evaluated by PostgreSQL, which
 * always returns an absolute UTC instant for a `timestamp with time zone` column regardless of the
 * database server's local timezone setting -- this is the "one documented timezone" the publication
 * pipeline uses. Administrators enter the publication date/time as UTC in the admin form (labeled
 * accordingly); nothing here interprets it in the administrator's local browser timezone. */
export const NEWS_STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];

export const STATUS_LABELS: Record<NewsStatus, string> = {
  archived: 'Archived', draft: 'Draft', published: 'Published', scheduled: 'Scheduled',
};

export const NEWS_TITLE_MAX_LENGTH = 200;
export const NEWS_SUBTITLE_MAX_LENGTH = 300;
export const NEWS_SLUG_MAX_LENGTH = 160;
export const NEWS_CONTENT_MAX_LENGTH = 20_000;
const PUBLIC_PAGE_SIZE = 10;
const ADMIN_PAGE_SIZE = 20;

export class NewsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NewsValidationError';
  }
}

const titleSchema = z.string().trim().min(1).max(NEWS_TITLE_MAX_LENGTH);
const subtitleSchema = z.string().trim().max(NEWS_SUBTITLE_MAX_LENGTH).nullable();
const contentSchema = z.string().min(1).max(NEWS_CONTENT_MAX_LENGTH);
const slugSchema = z.string().trim().toLowerCase().min(1).max(NEWS_SLUG_MAX_LENGTH).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const statusSchema = z.enum(NEWS_STATUSES);
const idSchema = z.coerce.number().int().positive();
const isoDateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

/** The admin publication-date field is an HTML `datetime-local` input (labeled "UTC" in the form),
 * which submits a bare `YYYY-MM-DDTHH:mm` string carrying no timezone designator at all. Treating
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

async function requireNewsAdministrator() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return actor;
}

type ArticleInput = { contentHtml: unknown; publicationDate: unknown; slug: unknown; status: unknown; subtitle: unknown; title: unknown };

function validateFields(input: ArticleInput) {
  const title = parse(titleSchema, input.title, 'Title is required and must be 200 characters or fewer.');
  const subtitleRaw = typeof input.subtitle === 'string' ? input.subtitle.trim() : '';
  const subtitle = subtitleRaw ? parse(subtitleSchema, subtitleRaw, 'Subtitle must be 300 characters or fewer.') : null;
  const rawContent = typeof input.contentHtml === 'string' ? input.contentHtml : '';
  const sanitizedContent = sanitizeArticleContent(rawContent);
  if (!hasVisibleContent(sanitizedContent)) throw new NewsValidationError('Article content cannot be empty.');
  const contentHtml = parse(contentSchema, sanitizedContent, 'Article content must be 20,000 characters or fewer.');
  const status = parse(statusSchema, input.status, 'Choose a valid publication status.');
  const publicationDateIso = parse(isoDateSchema, input.publicationDate, 'Enter a valid publication date.');
  const publicationDate = parseAsUtc(publicationDateIso);
  if (status === 'scheduled' && publicationDate.getTime() <= Date.now()) {
    throw new NewsValidationError('Scheduled articles require a publication date in the future.');
  }
  const slugInput = typeof input.slug === 'string' ? input.slug.trim() : '';
  const slug = parse(slugSchema, slugInput || slugify(title), 'Slug must use lowercase letters, numbers, and hyphens only.');
  return { contentHtml, publicationDate, slug, status, subtitle, title };
}

export async function listAdminArticles(input: Record<string, string | string[] | undefined>) {
  await requireNewsAdministrator();
  const firstValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const page = Math.max(1, Number.parseInt(firstValue(input.page) ?? '1', 10) || 1);
  const statusValue = firstValue(input.status);
  const status: NewsStatus | null = NEWS_STATUSES.includes(statusValue as NewsStatus) ? (statusValue as NewsStatus) : null;
  const search = (firstValue(input.q) ?? '').trim().slice(0, 100);
  const fromValue = firstValue(input.from) ?? '';
  const toValue = firstValue(input.to) ?? '';
  const sortValue = firstValue(input.sort) ?? '';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromValue) ? fromValue : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toValue) ? toValue : null;
  const sort = ['publication', 'title', 'status', 'updated'].includes(sortValue) ? sortValue : 'publication';
  const direction = firstValue(input.direction) === 'asc' ? 'asc' : 'desc';
  const limit = ADMIN_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const rows = await client`select id,slug,title,subtitle,status,publication_date,published_at,updated_at from idoc.news_articles
    where (${status}::text is null or status=${status}) and (${search}='' or title ilike ${`%${search}%`} or subtitle ilike ${`%${search}%`} or slug ilike ${`%${search}%`})
    and (${from}::date is null or publication_date>=${from}::date) and (${to}::date is null or publication_date<(${to}::date + interval '1 day'))
    order by case when ${sort}='publication' and ${direction}='asc' then publication_date end asc,
      case when ${sort}='publication' and ${direction}='desc' then publication_date end desc,
      case when ${sort}='title' and ${direction}='asc' then title end asc,
      case when ${sort}='title' and ${direction}='desc' then title end desc,
      case when ${sort}='status' and ${direction}='asc' then status end asc,
      case when ${sort}='status' and ${direction}='desc' then status end desc,
      case when ${sort}='updated' and ${direction}='asc' then updated_at end asc,
      case when ${sort}='updated' and ${direction}='desc' then updated_at end desc,
      publication_date desc,id desc limit ${limit + 1} offset ${offset}`;
  return { hasNext: rows.length > limit, page, rows: rows.slice(0, limit) };
}

export async function getAdminArticle(value: unknown) {
  await requireNewsAdministrator();
  const parsedId = idSchema.safeParse(value);
  if (!parsedId.success) return null;
  const [row] = await client`select * from idoc.news_articles where id=${parsedId.data} limit 1`;
  return row ?? null;
}

export async function createArticle(input: ArticleInput) {
  const actor = await requireNewsAdministrator();
  const fields = validateFields(input);
  return client.begin(async (sql) => {
    const slugTaken = await sql<{ id: number }[]>`select id from idoc.news_articles where slug=${fields.slug} limit 1`;
    if (slugTaken[0]) throw new NewsValidationError('That slug is already in use by another article.');
    const publishedAt = fields.status === 'published' ? new Date() : null;
    const [row] = await sql<{ id: number }[]>`insert into idoc.news_articles
      (slug,title,subtitle,content_html,status,publication_date,published_at,created_by_user_id,updated_by_user_id)
      values (${fields.slug},${fields.title},${fields.subtitle},${fields.contentHtml},${fields.status},${iso(fields.publicationDate)},${iso(publishedAt)},${actor.id},${actor.id})
      returning id`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values
      (${actor.id},'admin.news_article.created','news_article',${String(row.id)},${JSON.stringify({ slug: fields.slug, status: fields.status, title: fields.title })}::jsonb)`;
    return row.id;
  });
}

export async function updateArticle(idValue: unknown, input: ArticleInput) {
  const actor = await requireNewsAdministrator();
  const id = parse(idSchema, idValue, 'Article not found.');
  const fields = validateFields(input);
  await client.begin(async (sql) => {
    const [existing] = await sql<{
      published_at: Date | string | null; slug: string; status: NewsStatus; title: string;
    }[]>`select slug,status,title,published_at from idoc.news_articles where id=${id} for update`;
    if (!existing) throw new NewsValidationError('Article not found.');
    const slugTaken = await sql<{ id: number }[]>`select id from idoc.news_articles where slug=${fields.slug} and id<>${id} limit 1`;
    if (slugTaken[0]) throw new NewsValidationError('That slug is already in use by another article.');
    const publishedAt = fields.status === 'published' ? (existing.published_at ?? new Date()) : null;
    await sql`update idoc.news_articles set slug=${fields.slug},title=${fields.title},subtitle=${fields.subtitle},
      content_html=${fields.contentHtml},status=${fields.status},publication_date=${iso(fields.publicationDate)},
      published_at=${iso(publishedAt)},updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    const changedFields = [
      existing.slug !== fields.slug && 'slug', existing.title !== fields.title && 'title', existing.status !== fields.status && 'status',
    ].filter(Boolean);
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
      (${actor.id},'admin.news_article.edited','news_article',${String(id)},
      ${JSON.stringify({ slug: existing.slug, status: existing.status, title: existing.title })}::jsonb,
      ${JSON.stringify({ changedFields, slug: fields.slug, status: fields.status, title: fields.title })}::jsonb)`;
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
  const publicationDate = parseAsUtc(publicationDateIso);
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

/** Vercel Cron entry point (see app/api/cron/news-scheduled-publish/route.ts): transitions every
 * 'scheduled' article whose publicationDate has passed to 'published'. Comparisons happen entirely
 * in PostgreSQL via `now()`, the documented single evaluation clock for scheduled publication. */
export async function publishScheduledArticles(): Promise<{ published: number }> {
  return client.begin(async (sql) => {
    const rows = await sql<{ id: number }[]>`select id from idoc.news_articles where status='scheduled' and publication_date<=now() for update skip locked`;
    for (const row of rows) {
      await sql`update idoc.news_articles set status='published',published_at=now(),updated_at=now() where id=${row.id}`;
      await sql`insert into idoc.audit_log(action,entity_type,entity_id,after_json) values
        ('admin.news_article.published','news_article',${String(row.id)},${JSON.stringify({ trigger: 'scheduled_publish_cron' })}::jsonb)`;
    }
    return { published: rows.length };
  });
}

export async function listPublicArticles(pageValue: unknown) {
  const page = Math.max(1, Number.parseInt(typeof pageValue === 'string' ? pageValue : '1', 10) || 1);
  const limit = PUBLIC_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const rows = await client`select slug,title,subtitle,publication_date from idoc.news_articles
    where status='published' and publication_date<=now() order by publication_date desc limit ${limit + 1} offset ${offset}`;
  return { hasNext: rows.length > limit, page, rows: rows.slice(0, limit) };
}

export async function getPublicArticleBySlug(value: unknown) {
  const parsedSlug = slugSchema.safeParse(value);
  if (!parsedSlug.success) return null;
  const [row] = await client`select slug,title,subtitle,content_html,publication_date from idoc.news_articles
    where slug=${parsedSlug.data} and status='published' and publication_date<=now() limit 1`;
  return row ?? null;
}
