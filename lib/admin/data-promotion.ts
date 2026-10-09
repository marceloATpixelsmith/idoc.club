import 'server-only';

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';

export type PromotionDataset = 'news' | 'organization' | 'seminar';
export type PromotionAction = 'create' | 'reject' | 'skip' | 'update';

export type PromotionCandidate = { id: string; label: string; meta: string };
export type PromotionChange = { field: string; from: string; to: string };
export type PromotionPreviewItem = {
  action: PromotionAction;
  changes: PromotionChange[];
  label: string;
  promotionKey: string;
  reason?: string;
  sourceId: string;
  warnings: string[];
};
export type PromotionPreview = {
  dataset: PromotionDataset;
  expiresAt: string;
  items: PromotionPreviewItem[];
  operationId: string;
  planToken?: string;
};
export type PromotionHistoryItem = {
  createdAt: string;
  dataset: string;
  operationId: string;
  result: string;
  summary: string;
};

type PromotionPlanItem = {
  action: Exclude<PromotionAction, 'reject'>;
  promotionKey: string;
  sourceHash: string;
  sourceId: string;
  targetHash: string | null;
};
type PromotionPlanPayload = {
  dataset: PromotionDataset;
  expiresAt: number;
  issuedAt: number;
  items: PromotionPlanItem[];
  operationId: string;
  version: 1;
};
type Row = Record<string, unknown>;
type PromotionSql = ReturnType<typeof postgres>;

const MAX_RECORDS = 10;
const PLAN_TTL_MS = 5 * 60 * 1000;
const EXPECTED_DATABASE = 'ayni_space';
const EXPECTED_ROLE = 'idoc_data_promoter';
const NEWS_FIELDS = ['slug', 'title', 'subtitle', 'content_html', 'article_type', 'audience', 'thumbnail_url',
  'external_url', 'status', 'publication_date', 'published_at', 'archived_at'] as const;
const SEMINAR_FIELDS = ['title', 'description', 'start_date', 'end_date', 'start_time', 'end_time', 'timezone',
  'location', 'language', 'organizing_national_federation', 'course_directors', 'participant_profile',
  'course_venue_information', 'application', 'accommodation_information', 'capacity', 'member_price_cents',
  'non_member_price_cents', 'registration_deadline', 'status', 'is_fei', 'levels'] as const;
const ORGANIZATION_FIELDS = ['address_1', 'address_2', 'city', 'state_province', 'postal_code', 'country'] as const;

let promotionConnection: PromotionSql | undefined;
let boundaryVerification: Promise<void> | undefined;

export class DataPromotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataPromotionError';
  }
}

function configuration() {
  if (process.env.DB_SCHEMA !== 'idoc_staging') {
    throw new DataPromotionError('Data promotion is available only from the staging application.');
  }
  if (process.env.VERCEL === '1' && process.env.VERCEL_GIT_COMMIT_REF !== 'staging') {
    throw new DataPromotionError('Data promotion is disabled outside the protected staging branch deployment.');
  }
  const databaseUrl = process.env.DATA_PROMOTION_DATABASE_URL?.trim();
  const planSecret = process.env.DATA_PROMOTION_PLAN_SECRET?.trim();
  if (!databaseUrl) throw new DataPromotionError('Data promotion credentials are not configured.');
  if (!planSecret || Buffer.byteLength(planSecret, 'utf8') < 32) {
    throw new DataPromotionError('The data promotion plan secret is missing or too short.');
  }
  return { databaseUrl, planSecret };
}

function promotionSql() {
  const { databaseUrl } = configuration();
  promotionConnection ??= postgres(databaseUrl, {
    connect_timeout: 10,
    connection: { application_name: 'idoc-data-promotion' },
    idle_timeout: 10,
    max: 1,
    max_lifetime: 120,
  });
  return promotionConnection;
}

async function rows<T = Row>(sql: PromotionSql, query: string, params: unknown[] = []) {
  return await sql.unsafe(query, params as never[]) as unknown as T[];
}

async function verifyBoundary() {
  boundaryVerification ??= (async () => {
    const sql = promotionSql();
    const identity = await rows<{ database_name: string; role_name: string }>(
      sql, 'select current_database() as database_name, current_user as role_name');
    if (!identity[0] || identity[0].database_name !== EXPECTED_DATABASE || identity[0].role_name !== EXPECTED_ROLE) {
      throw new DataPromotionError('Data promotion database identity verification failed.');
    }
    const schemas = await rows<{ staging: string | null; production: string | null }>(
      sql, "select to_regnamespace('idoc_staging')::text as staging, to_regnamespace('idoc_production')::text as production");
    if (!schemas[0]?.staging || !schemas[0].production || schemas[0].staging === schemas[0].production) {
      throw new DataPromotionError('The staging and production schema boundary is not available.');
    }
    const columns = await rows<{ count: number }>(sql,
      "select count(*)::int as count from information_schema.columns where table_schema in ('idoc_staging','idoc_production') and table_name in ('news_articles','seminars') and column_name='promotion_key'");
    if (Number(columns[0]?.count ?? 0) !== 4) {
      throw new DataPromotionError('The data promotion schema migration has not been applied to both environments.');
    }
  })();
  return boundaryVerification;
}

export function parsePromotionDataset(value: unknown): PromotionDataset | null {
  return value === 'news' || value === 'seminar' || value === 'organization' ? value : null;
}

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  return value ?? null;
}

function projection(row: Row, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, canonicalValue(row[field])]));
}

function digestRecord(row: Row | null, fields: readonly string[]) {
  if (!row) return null;
  return createHash('sha256').update(JSON.stringify(projection(row, fields))).digest('hex');
}

function fieldText(value: unknown) {
  const normalized = canonicalValue(value);
  if (normalized === null) return '—';
  if (Array.isArray(normalized)) return normalized.map(String).join(', ') || '—';
  const text = String(normalized);
  return text.length > 140 ? text.slice(0, 137) + '…' : text;
}

function changesBetween(source: Row, target: Row | null, fields: readonly string[]): PromotionChange[] {
  return fields.flatMap((field) => {
    const sourceValue = canonicalValue(source[field]);
    const targetValue = target ? canonicalValue(target[field]) : null;
    return JSON.stringify(sourceValue) === JSON.stringify(targetValue)
      ? [] : [{ field, from: fieldText(targetValue), to: fieldText(sourceValue) }];
  });
}

function validSelectionIds(dataset: PromotionDataset, values: readonly string[]) {
  const unique = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (!unique.length || unique.length > MAX_RECORDS) {
    throw new DataPromotionError('Choose between 1 and ' + MAX_RECORDS + ' records for one promotion.');
  }
  if (dataset === 'organization') {
    if (unique.length !== 1 || unique[0] !== '1') {
      throw new DataPromotionError('Organization Settings uses the protected singleton record.');
    }
    return unique;
  }
  if (unique.some((value) => !/^\d+$/.test(value) || Number(value) <= 0)) {
    throw new DataPromotionError('One or more selected records are invalid.');
  }
  return unique;
}

function recordFields(dataset: PromotionDataset) {
  if (dataset === 'news') return NEWS_FIELDS;
  if (dataset === 'seminar') return SEMINAR_FIELDS;
  return ORGANIZATION_FIELDS;
}

function roleAudience(audience: readonly string[]) {
  return audience.filter((value) => ['judge', 'steward', 'veterinarian'].includes(value));
}

export function newsVisibilityBroadens(source: readonly string[], target: readonly string[]) {
  if (target.includes('public')) return false;
  if (source.includes('public')) return true;
  if (target.includes('members')) return false;
  if (source.includes('members')) return true;
  const targetRoles = new Set(roleAudience(target));
  return roleAudience(source).some((value) => !targetRoles.has(value));
}

function cloudinaryWarnings(row: Row) {
  const text = [row.thumbnail_url, row.content_html].filter((value) => typeof value === 'string').join(' ');
  const urls = text.match(/https?:\/\/[^"'\s<>)]+/g) ?? [];
  const cloudinary = urls.filter((url) => url.includes('res.cloudinary.com/'));
  if (cloudinary.some((url) => !url.startsWith('https://'))) {
    throw new DataPromotionError('Cloudinary references must use HTTPS before the article can be promoted.');
  }
  return cloudinary.length
    ? [String(cloudinary.length) + ' Cloudinary asset reference(s) will be reused in Production; assets are referenced, not copied.']
    : [];
}

async function sourceRow(sql: PromotionSql, dataset: PromotionDataset, sourceId: string): Promise<Row | null> {
  if (dataset === 'news') {
    const result = await rows(sql,
      'select id,promotion_key,slug,title,subtitle,content_html,article_type,audience,thumbnail_url,external_url,status,publication_date,published_at,archived_at from idoc_staging.news_articles where id=$1 limit 1',
      [Number(sourceId)]);
    return result[0] ?? null;
  }
  if (dataset === 'seminar') {
    const result = await rows(sql,
      'select id,promotion_key,title,description,start_date,end_date,start_time,end_time,timezone,location,language,organizing_national_federation,course_directors,participant_profile,course_venue_information,application,accommodation_information,capacity,member_price_cents,non_member_price_cents,registration_deadline,status,is_fei,levels from idoc_staging.seminars where id=$1 limit 1',
      [Number(sourceId)]);
    return result[0] ?? null;
  }
  const result = await rows(sql,
    'select id,address_1,address_2,city,state_province,postal_code,country from idoc_staging.organization_settings where id=1 limit 1');
  return result[0] ?? null;
}

async function targetRow(sql: PromotionSql, dataset: PromotionDataset, source: Row): Promise<Row | null> {
  if (dataset === 'news') {
    const result = await rows(sql,
      'select id,promotion_key,slug,title,subtitle,content_html,article_type,audience,thumbnail_url,external_url,status,publication_date,published_at,archived_at from idoc_production.news_articles where promotion_key=$1::uuid limit 1',
      [String(source.promotion_key)]);
    return result[0] ?? null;
  }
  if (dataset === 'seminar') {
    const result = await rows(sql,
      'select id,promotion_key,title,description,start_date,end_date,start_time,end_time,timezone,location,language,organizing_national_federation,course_directors,participant_profile,course_venue_information,application,accommodation_information,capacity,member_price_cents,non_member_price_cents,registration_deadline,status,is_fei,levels from idoc_production.seminars where promotion_key=$1::uuid limit 1',
      [String(source.promotion_key)]);
    return result[0] ?? null;
  }
  const result = await rows(sql,
    'select id,address_1,address_2,city,state_province,postal_code,country from idoc_production.organization_settings where id=1 limit 1');
  return result[0] ?? null;
}

async function conflictReason(sql: PromotionSql, dataset: PromotionDataset, source: Row, target: Row | null) {
  if (target) return null;
  if (dataset === 'news') {
    const conflict = await rows(sql, 'select id from idoc_production.news_articles where slug=$1 limit 1', [String(source.slug)]);
    return conflict.length
      ? 'Production already has this slug under a different promotion identity. Resolve the conflict manually before promotion.'
      : null;
  }
  if (dataset === 'seminar') {
    const conflict = await rows(sql,
      'select id from idoc_production.seminars where title=$1 and start_date=$2 and end_date=$3 limit 1',
      [String(source.title), String(canonicalValue(source.start_date)), String(canonicalValue(source.end_date))]);
    return conflict.length
      ? 'Production already has a matching seminar under a different promotion identity. Resolve the conflict manually before promotion.'
      : null;
  }
  return 'The Production organization-settings singleton is missing and must be repaired before promotion.';
}

async function previewItem(sql: PromotionSql, dataset: PromotionDataset, sourceId: string): Promise<{
  item: PromotionPreviewItem;
  planItem?: PromotionPlanItem;
}> {
  const source = await sourceRow(sql, dataset, sourceId);
  if (!source) {
    return { item: { action: 'reject', changes: [], label: 'Record ' + sourceId, promotionKey: '',
      reason: 'The staging record no longer exists.', sourceId, warnings: [] } };
  }
  const promotionKey = dataset === 'organization' ? 'organization:1' : String(source.promotion_key ?? '');
  if (dataset !== 'organization' && !/^[0-9a-f-]{36}$/i.test(promotionKey)) {
    return { item: { action: 'reject', changes: [], label: 'Record ' + sourceId, promotionKey,
      reason: 'The staging record has no valid promotion identity.', sourceId, warnings: [] } };
  }
  const target = await targetRow(sql, dataset, source);
  const fields = recordFields(dataset);
  const changes = changesBetween(source, target, fields);
  const label = dataset === 'organization' ? 'Organization Settings' : String(source.title ?? ('Record ' + sourceId));
  const conflict = await conflictReason(sql, dataset, source, target);
  if (conflict) return { item: { action: 'reject', changes, label, promotionKey, reason: conflict, sourceId, warnings: [] } };
  const warnings = dataset === 'news' ? cloudinaryWarnings(source) : [];

  if (dataset === 'news' && target) {
    const sourceAudience = Array.isArray(source.audience) ? source.audience.map(String) : [];
    const targetAudience = Array.isArray(target.audience) ? target.audience.map(String) : [];
    if (newsVisibilityBroadens(sourceAudience, targetAudience)) {
      return { item: { action: 'reject', changes, label, promotionKey,
        reason: 'This update would broaden the Production article audience. Change Production visibility explicitly instead of promoting a broader audience.',
        sourceId, warnings } };
    }
  }

  if (dataset === 'seminar' && target && changes.length) {
    const registrations = await rows<{ count: number }>(sql,
      'select count(*)::int as count from idoc_production.seminar_registrations where seminar_id=$1',
      [Number(target.id)]);
    if (Number(registrations[0]?.count ?? 0) > 0) {
      return { item: { action: 'reject', changes, label, promotionKey,
        reason: 'This Production seminar already has registrations. Promotion cannot modify a seminar after registration activity exists.',
        sourceId, warnings } };
    }
  }

  const action: PromotionAction = changes.length ? (target ? 'update' : 'create') : 'skip';
  return {
    item: { action, changes, label, promotionKey, sourceId, warnings },
    planItem: { action, promotionKey, sourceHash: digestRecord(source, fields)!, sourceId,
      targetHash: digestRecord(target, fields) },
  };
}

function signPlan(payload: PromotionPlanPayload) {
  const { planSecret } = configuration();
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', planSecret).update(encoded).digest('base64url');
  return encoded + '.' + signature;
}

function readPlan(token: string): PromotionPlanPayload {
  const { planSecret } = configuration();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new DataPromotionError('The promotion plan is invalid.');
  const expected = createHmac('sha256', planSecret).update(parts[0]).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[1], 'base64url');
  } catch {
    throw new DataPromotionError('The promotion plan is invalid.');
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new DataPromotionError('The promotion plan signature is invalid.');
  }
  let payload: PromotionPlanPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as PromotionPlanPayload;
  } catch {
    throw new DataPromotionError('The promotion plan could not be read.');
  }
  if (payload.version !== 1 || !parsePromotionDataset(payload.dataset) || !/^[0-9a-f-]{36}$/i.test(payload.operationId) ||
    !Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now() ||
    payload.expiresAt - payload.issuedAt > PLAN_TTL_MS || !Array.isArray(payload.items) ||
    payload.items.length < 1 || payload.items.length > MAX_RECORDS) {
    throw new DataPromotionError('The promotion plan is stale or invalid. Generate a new preview.');
  }
  return payload;
}

export async function listPromotionCandidates(dataset: PromotionDataset): Promise<PromotionCandidate[]> {
  await verifyBoundary();
  const sql = promotionSql();
  if (dataset === 'news') {
    const result = await rows<{ id: number; title: string; status: string; article_type: string }>(sql,
      'select id,title,status,article_type from idoc_staging.news_articles order by updated_at desc,id desc limit 100');
    return result.map((row) => ({ id: String(row.id), label: row.title, meta: row.article_type.toUpperCase() + ' · ' + row.status }));
  }
  if (dataset === 'seminar') {
    const result = await rows<{ id: number; title: string; status: string; start_date: string }>(sql,
      'select id,title,status,start_date from idoc_staging.seminars order by start_date desc,id desc limit 100');
    return result.map((row) => ({ id: String(row.id), label: row.title, meta: String(row.start_date) + ' · ' + row.status }));
  }
  const result = await rows<{ id: number; city: string | null; country: string | null }>(sql,
    'select id,city,country from idoc_staging.organization_settings where id=1');
  return result.map((row) => ({ id: '1', label: 'Organization Settings',
    meta: [row.city, row.country].filter(Boolean).join(', ') || 'Public address fields' }));
}

export async function buildPromotionPlan(dataset: PromotionDataset, sourceIds: readonly string[]): Promise<PromotionPreview> {
  await verifyBoundary();
  const selected = validSelectionIds(dataset, sourceIds);
  const sql = promotionSql();
  const built = [];
  for (const sourceId of selected) built.push(await previewItem(sql, dataset, sourceId));
  const operationId = randomUUID();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + PLAN_TTL_MS;
  const items = built.map(({ item }) => item);
  const planItems = built.flatMap(({ planItem }) => planItem ? [planItem] : []);
  const executable = items.every((item) => item.action !== 'reject') && items.some((item) => item.action !== 'skip');
  return { dataset, expiresAt: new Date(expiresAt).toISOString(), items, operationId,
    planToken: executable ? signPlan({ dataset, expiresAt, issuedAt, items: planItems, operationId, version: 1 }) : undefined };
}

async function productionOperator(tx: PromotionSql, stagingActorId: number) {
  const staging = await rows<{ email: string }>(tx,
    "select u.email from idoc_staging.users u where u.id=$1 and u.deleted_at is null and u.account_state in ('active','onboarding') and exists (select 1 from idoc_staging.application_roles r where r.user_id=u.id and r.role='super_admin' and r.revoked_at is null) limit 1",
    [stagingActorId]);
  if (!staging[0]) throw new DataPromotionError('Current staging Super Admin authority could not be revalidated.');
  const production = await rows<{ id: number }>(tx,
    "select u.id from idoc_production.users u where lower(u.email)=lower($1) and u.deleted_at is null and u.account_state in ('active','onboarding') and exists (select 1 from idoc_production.application_roles r where r.user_id=u.id and r.role='super_admin' and r.revoked_at is null) limit 1",
    [staging[0].email]);
  if (!production[0]) {
    throw new DataPromotionError('Your Super Admin identity must exist with active Super Admin authority in Production before data can be promoted.');
  }
  return production[0].id;
}

async function applyNews(tx: PromotionSql, source: Row, target: Row | null, actorId: number) {
  if (!target) {
    const collision = await rows(tx, 'select id from idoc_production.news_articles where slug=$1 limit 1', [String(source.slug)]);
    if (collision.length) throw new DataPromotionError('The Production article slug now conflicts with another record.');
    const result = await rows<{ id: number }>(tx,
      'insert into idoc_production.news_articles (promotion_key,slug,title,subtitle,content_html,article_type,audience,thumbnail_url,external_url,status,publication_date,published_at,archived_at,created_by_user_id,updated_by_user_id) values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) returning id',
      [String(source.promotion_key), String(source.slug), String(source.title), source.subtitle, String(source.content_html),
        String(source.article_type), source.audience, source.thumbnail_url, source.external_url, String(source.status),
        source.publication_date, source.published_at, source.archived_at, actorId]);
    return result[0].id;
  }
  const collision = await rows(tx, 'select id from idoc_production.news_articles where slug=$1 and id<>$2 limit 1',
    [String(source.slug), Number(target.id)]);
  if (collision.length) throw new DataPromotionError('The Production article slug now conflicts with another record.');
  await rows(tx,
    'update idoc_production.news_articles set slug=$1,title=$2,subtitle=$3,content_html=$4,article_type=$5,audience=$6,thumbnail_url=$7,external_url=$8,status=$9,publication_date=$10,published_at=$11,archived_at=$12,updated_by_user_id=$13,updated_at=now() where id=$14 returning id',
    [String(source.slug), String(source.title), source.subtitle, String(source.content_html), String(source.article_type),
      source.audience, source.thumbnail_url, source.external_url, String(source.status), source.publication_date,
      source.published_at, source.archived_at, actorId, Number(target.id)]);
  return Number(target.id);
}

async function applySeminar(tx: PromotionSql, source: Row, target: Row | null, actorId: number) {
  if (!target) {
    const result = await rows<{ id: number }>(tx,
      'insert into idoc_production.seminars (promotion_key,title,description,start_date,end_date,start_time,end_time,timezone,location,language,organizing_national_federation,course_directors,participant_profile,course_venue_information,application,accommodation_information,capacity,member_price_cents,non_member_price_cents,registration_deadline,status,is_fei,levels,created_by_user_id,updated_by_user_id) values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24) returning id',
      [String(source.promotion_key), String(source.title), String(source.description), canonicalValue(source.start_date),
        canonicalValue(source.end_date), source.start_time, source.end_time, source.timezone, String(source.location),
        String(source.language), String(source.organizing_national_federation), String(source.course_directors),
        String(source.participant_profile), String(source.course_venue_information), String(source.application),
        String(source.accommodation_information), Number(source.capacity), Number(source.member_price_cents),
        Number(source.non_member_price_cents), source.registration_deadline, String(source.status), Boolean(source.is_fei),
        source.levels, actorId]);
    return result[0].id;
  }
  const registrations = await rows<{ count: number }>(tx,
    'select count(*)::int as count from idoc_production.seminar_registrations where seminar_id=$1', [Number(target.id)]);
  if (Number(registrations[0]?.count ?? 0) > 0) {
    throw new DataPromotionError('The Production seminar gained registration activity after preview. Promotion was rejected.');
  }
  await rows(tx,
    'update idoc_production.seminars set title=$1,description=$2,start_date=$3,end_date=$4,start_time=$5,end_time=$6,timezone=$7,location=$8,language=$9,organizing_national_federation=$10,course_directors=$11,participant_profile=$12,course_venue_information=$13,application=$14,accommodation_information=$15,capacity=$16,member_price_cents=$17,non_member_price_cents=$18,registration_deadline=$19,status=$20,is_fei=$21,levels=$22,updated_by_user_id=$23,updated_at=now() where id=$24 returning id',
    [String(source.title), String(source.description), canonicalValue(source.start_date), canonicalValue(source.end_date),
      source.start_time, source.end_time, source.timezone, String(source.location), String(source.language),
      String(source.organizing_national_federation), String(source.course_directors), String(source.participant_profile),
      String(source.course_venue_information), String(source.application), String(source.accommodation_information),
      Number(source.capacity), Number(source.member_price_cents), Number(source.non_member_price_cents),
      source.registration_deadline, String(source.status), Boolean(source.is_fei), source.levels, actorId, Number(target.id)]);
  return Number(target.id);
}

async function applyOrganization(tx: PromotionSql, source: Row, target: Row | null) {
  if (!target) throw new DataPromotionError('The Production organization-settings singleton is missing.');
  await rows(tx,
    'update idoc_production.organization_settings set address_1=$1,address_2=$2,city=$3,state_province=$4,postal_code=$5,country=$6,updated_at=now() where id=1 returning id',
    [source.address_1, source.address_2, source.city, source.state_province, source.postal_code, source.country]);
  return 1;
}

export async function executePromotionPlan(token: string, stagingActorId: number) {
  await verifyBoundary();
  const payload = readPlan(token);
  const sql = promotionSql();
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as PromotionSql;
    await rows(tx, 'select pg_advisory_xact_lock(hashtext($1))', ['idoc-data-promotion:' + payload.operationId]);
    const existing = await rows(tx,
      "select id from idoc_staging.audit_log where action='admin.data_promotion.succeeded' and entity_type='data_promotion' and entity_id=$1 limit 1",
      [payload.operationId]);
    if (existing.length) return { duplicate: true, operationId: payload.operationId };

    const productionActorId = await productionOperator(tx, stagingActorId);
    const results: Array<{ action: string; changedFields: string[]; sourceId: string; targetId: number }> = [];

    for (const planned of payload.items) {
      await rows(tx, 'select pg_advisory_xact_lock(hashtext($1))', ['idoc-data-promotion-record:' + planned.promotionKey]);
      const source = await sourceRow(tx, payload.dataset, planned.sourceId);
      if (!source) throw new DataPromotionError('A staging record was deleted after preview. Generate a new preview.');
      const target = await targetRow(tx, payload.dataset, source);
      const fields = recordFields(payload.dataset);
      if (digestRecord(source, fields) !== planned.sourceHash || digestRecord(target, fields) !== planned.targetHash) {
        throw new DataPromotionError('Staging or Production changed after preview. Generate a new preview before executing.');
      }
      const reviewed = await previewItem(tx, payload.dataset, planned.sourceId);
      if (!reviewed.planItem || reviewed.item.action === 'reject' || reviewed.planItem.action !== planned.action) {
        throw new DataPromotionError(reviewed.item.reason ?? 'The promotion policy changed after preview. Generate a new preview.');
      }
      if (planned.action === 'skip') continue;

      let targetId: number;
      if (payload.dataset === 'news') targetId = await applyNews(tx, source, target, productionActorId);
      else if (payload.dataset === 'seminar') targetId = await applySeminar(tx, source, target, productionActorId);
      else targetId = await applyOrganization(tx, source, target);

      const changedFields = reviewed.item.changes.map((change) => change.field);
      const entityType = payload.dataset === 'news' ? 'news_article'
        : payload.dataset === 'seminar' ? 'seminar' : 'organization_settings';
      await rows(tx,
        "insert into idoc_production.audit_log (actor_id,action,entity_type,entity_id,after_json,reason) values ($1,'admin.data_promotion.applied',$2,$3,$4::jsonb,'approved_staging_data_promotion') returning id",
        [productionActorId, entityType, String(targetId),
          JSON.stringify({ changedFields, operationId: payload.operationId, sourcePromotionKey: planned.promotionKey })]);
      results.push({ action: planned.action, changedFields, sourceId: planned.sourceId, targetId });
    }

    await rows(tx,
      "insert into idoc_staging.audit_log (actor_id,action,entity_type,entity_id,after_json,reason) values ($1,'admin.data_promotion.succeeded','data_promotion',$2,$3::jsonb,'explicit_super_admin_promotion') returning id",
      [stagingActorId, payload.operationId, JSON.stringify({ dataset: payload.dataset, results })]);
    return { duplicate: false, operationId: payload.operationId, results };
  });
}

export async function listPromotionHistory(limit = 25): Promise<PromotionHistoryItem[]> {
  await verifyBoundary();
  const result = await rows<{ after_json: unknown; created_at: Date; entity_id: string }>(promotionSql(),
    "select entity_id,after_json,created_at from idoc_staging.audit_log where action='admin.data_promotion.succeeded' and entity_type='data_promotion' order by created_at desc limit $1",
    [Math.min(Math.max(limit, 1), 100)]);
  return result.map((row) => {
    const payload = row.after_json && typeof row.after_json === 'object'
      ? row.after_json as { dataset?: string; results?: unknown[] } : {};
    const count = Array.isArray(payload.results) ? payload.results.length : 0;
    return { createdAt: row.created_at.toISOString(), dataset: payload.dataset ?? 'unknown',
      operationId: row.entity_id, result: 'succeeded',
      summary: String(count) + ' record' + (count === 1 ? '' : 's') + ' changed' };
  });
}
