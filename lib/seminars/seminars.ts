import 'server-only';
import { advancedListWhere, listDate, listOrder, listPage, listPageSize, many } from '@/lib/admin/resource-list-query';

import { z } from 'zod';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { sanitizeArticleContent, hasVisibleContent } from '@/lib/news/sanitize';
import { ISO_COUNTRY_CODES } from '@/lib/membership/validation';
import { canonicalLanguageTag } from '@/lib/seminars/language';
import { seminarEndsAtUtc, SEMINAR_STATUSES, type SeminarStatus } from '@/lib/seminars/status';

export { SEMINAR_STATUSES, type SeminarStatus } from '@/lib/seminars/status';

export const SEMINAR_TITLE_MAX_LENGTH = 200;
export const SEMINAR_DESCRIPTION_MAX_LENGTH = 10_000;
export const SEMINAR_LOCATION_MAX_LENGTH = 2000;
export const SEMINAR_MAX_PRICE_CENTS = 100_000_00;

export class SeminarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeminarValidationError';
  }
}

export const SEMINAR_LEVELS = ['level_1', 'level_2', 'level_3', 'all_levels'] as const;
export type SeminarLevel = (typeof SEMINAR_LEVELS)[number];

const titleSchema = z.string().trim().min(1).max(SEMINAR_TITLE_MAX_LENGTH);
const locationSchema = z.string().trim().min(1).max(SEMINAR_LOCATION_MAX_LENGTH);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const capacitySchema = z.coerce.number().int().min(1).max(100_000);
const priceSchema = z.coerce.number().min(0).max(SEMINAR_MAX_PRICE_CENTS / 100);
const statusSchema = z.enum(SEMINAR_STATUSES);
const isoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');
const idSchema = z.coerce.number().int().positive();

function parse<T>(schema: z.ZodType<T>, value: unknown, message = 'Review the seminar fields.'): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SeminarValidationError(message);
  return result.data;
}

/** Mirrors lib/news/articles.ts's parseAsUtc: the admin registration-deadline field is a bare
 * `datetime-local` input (labeled UTC) with no timezone designator of its own. */
function parseDeadlineAsUtc(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function requireSeminarAdministrator() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return actor;
}

type SeminarInput = {
  accommodationInformation: unknown; application: unknown; capacity: unknown; courseDirectors: unknown;
  courseVenueInformation: unknown; endDate: unknown; isFei: unknown; language: unknown; levels: unknown; location: unknown;
  memberPrice: unknown; nonMemberPrice: unknown; organizingNationalFederation: unknown; participantProfile: unknown;
  registrationDeadline: unknown; startDate: unknown; status: unknown; title: unknown;
};

function parseLevels(value: unknown): SeminarLevel[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const selected = raw.filter((entry): entry is SeminarLevel => typeof entry === 'string' && (SEMINAR_LEVELS as readonly string[]).includes(entry));
  // all_levels always stands alone -- it displays as the literal "All levels" rather than being
  // combined with individually-checked levels, so checking it discards any other selection.
  return selected.includes('all_levels') ? ['all_levels'] : [...new Set(selected)];
}

function richText(value: unknown, label: string): string {
  const sanitized = sanitizeArticleContent(typeof value === 'string' ? value : '');
  if (sanitized.length > SEMINAR_DESCRIPTION_MAX_LENGTH) throw new SeminarValidationError(`${label} must be 10,000 characters or fewer.`);
  return hasVisibleContent(sanitized) ? sanitized : '';
}

function validateFields(input: SeminarInput) {
  const title = parse(titleSchema, input.title, 'Title is required and must be 200 characters or fewer.');
  const location = parse(locationSchema, input.location, 'Location or meeting link is required and must be 2,000 characters or fewer.');
  const startDate = parse(dateSchema, input.startDate, 'Enter a valid start date.');
  const endDate = parse(dateSchema, input.endDate, 'Enter a valid end date.');
  if (endDate < startDate) throw new SeminarValidationError('The end date must be on or after the start date.');
  const capacity = parse(capacitySchema, input.capacity, 'Capacity must be a whole number of at least 1.');
  const memberPriceCents = Math.round(parse(priceSchema, input.memberPrice, 'Member price must be zero or a positive amount.') * 100);
  const nonMemberPriceCents = Math.round(parse(priceSchema, input.nonMemberPrice, 'Non-member price must be zero or a positive amount.') * 100);
  const status = parse(statusSchema, input.status, 'Choose a valid publication status.');
  const deadlineIso = parse(isoDateTimeSchema, input.registrationDeadline, 'Enter a valid registration deadline.');
  const registrationDeadline = parseDeadlineAsUtc(deadlineIso);
  if (registrationDeadline.getTime() >= new Date(`${startDate}T00:00:00Z`).getTime()) throw new SeminarValidationError('The registration deadline must be before the seminar start date.');
  const language = typeof input.language === 'string' ? canonicalLanguageTag(input.language) : null;
  if (!language) throw new SeminarValidationError('Choose a valid BCP 47 language.');
  const organizingNationalFederation = typeof input.organizingNationalFederation === 'string' ? input.organizingNationalFederation.toUpperCase() : '';
  if (!(ISO_COUNTRY_CODES as readonly string[]).includes(organizingNationalFederation)) throw new SeminarValidationError('Choose a valid National Federation.');
  return {
    accommodationInformation: richText(input.accommodationInformation, 'Accommodation Information'),
    application: richText(input.application, 'Application'), capacity,
    courseDirectors: richText(input.courseDirectors, 'Course Directors'),
    courseVenueInformation: richText(input.courseVenueInformation, 'Course Venue Information'), endDate,
    isFei: input.isFei === 'on' || input.isFei === true, language, levels: parseLevels(input.levels), location,
    memberPriceCents, nonMemberPriceCents, organizingNationalFederation,
    participantProfile: richText(input.participantProfile, 'Participant Profile'), registrationDeadline, startDate, status, title,
  };
}

export async function listAdminSeminars(input: Record<string, string | string[] | undefined>) {
  await requireSeminarAdministrator();
  const firstValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const page = listPage(input);
  const statuses = many(input.status).filter((value): value is SeminarStatus => SEMINAR_STATUSES.includes(value as SeminarStatus));
  const statusWhere = statuses.length ? client`s.status in ${client(statuses)}` : client`true`;
  const search = (firstValue(input.q) ?? '').trim().slice(0, 100);
  const fromValue = firstValue(input.from) ?? '';
  const toValue = firstValue(input.to) ?? '';
  const from = listDate(fromValue);
  const to = listDate(toValue);
  const order = listOrder(input, {
    date: 's.start_date', start: 's.start_date', end: 's.end_date', deadline: 's.registration_deadline', title: 's.title', status: 's.status',
    registrations: '(select count(*) from idoc.seminar_registrations r where r.seminar_id=s.id and r.registration_status=\'registered\')',
  }, 'date', 's.id');
  const advancedWhere = advancedListWhere(input, { title: 's.title', status: 's.status' }, SEMINAR_STATUSES);
  const limit = listPageSize(input);
  const offset = (page - 1) * limit;
  const rows = await client`select s.id,s.title,s.status,s.start_date,s.end_date,s.registration_deadline,s.capacity,
    s.member_price_cents,s.non_member_price_cents,count(*) over()::int total_count,
    (select count(*)::int from idoc.seminar_registrations r where r.seminar_id=s.id and r.registration_status='registered') registered_count
    from idoc.seminars s
    where (${statusWhere}) and (${search}='' or s.title ilike ${`%${search}%`} or s.location ilike ${`%${search}%`})
    and (${from}::date is null or s.start_date>=${from}::date) and (${to}::date is null or s.start_date<=${to}::date) and (${advancedWhere})
    order by ${order} limit ${limit + 1} offset ${offset}`;
  return { hasNext: rows.length > limit, page, pageSize: limit, rows: rows.slice(0, limit), total: Number(rows[0]?.total_count ?? 0) };
}

export type AdminSeminarRow = {
  accommodation_information: string; application: string; capacity: number; course_directors: string; course_venue_information: string;
  created_at: Date; created_by_user_id: number; end_date: string; id: number; is_fei: boolean; language: string; levels: string[];
  location: string; member_price_cents: number; non_member_price_cents: number; organizing_national_federation: string;
  participant_profile: string; registration_deadline: Date | string; start_date: string; status: SeminarStatus; title: string;
  updated_at: Date; updated_by_user_id: number;
};
export async function getAdminSeminar(value: unknown): Promise<AdminSeminarRow | null> {
  await requireSeminarAdministrator();
  const parsedId = idSchema.safeParse(value);
  if (!parsedId.success) return null;
  const [row] = await client<AdminSeminarRow[]>`select * from idoc.seminars where id=${parsedId.data} limit 1`;
  if (!row) return null;
  return { ...row, end_date: dateOnly(row.end_date), start_date: dateOnly(row.start_date) };
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export async function createSeminar(input: SeminarInput) {
  const actor = await requireSeminarAdministrator();
  const fields = validateFields(input);
  return client.begin(async (sql) => {
    const [row] = await sql<{ id: number }[]>`insert into idoc.seminars
      (title,description,start_date,end_date,location,language,organizing_national_federation,course_directors,participant_profile,course_venue_information,application,accommodation_information,capacity,member_price_cents,non_member_price_cents,registration_deadline,status,is_fei,levels,created_by_user_id,updated_by_user_id)
      values (${fields.title},'',${fields.startDate},${fields.endDate},${fields.location},${fields.language},${fields.organizingNationalFederation},${fields.courseDirectors},${fields.participantProfile},${fields.courseVenueInformation},${fields.application},${fields.accommodationInformation},${fields.capacity},${fields.memberPriceCents},${fields.nonMemberPriceCents},${iso(fields.registrationDeadline)},${fields.status},${fields.isFei},${sql.array(fields.levels)},${actor.id},${actor.id})
      returning id`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values
      (${actor.id},'admin.seminar.created','seminar',${String(row.id)},${JSON.stringify({ capacity: fields.capacity, memberPriceCents: fields.memberPriceCents, nonMemberPriceCents: fields.nonMemberPriceCents, status: fields.status, title: fields.title })}::jsonb)`;
    return row.id;
  });
}

export async function updateSeminar(idValue: unknown, input: SeminarInput) {
  const actor = await requireSeminarAdministrator();
  const id = parse(idSchema, idValue, 'Seminar not found.');
  const fields = validateFields(input);
  await client.begin(async (sql) => {
    const [existing] = await sql<{
      capacity: number; member_price_cents: number; non_member_price_cents: number; status: SeminarStatus; title: string;
    }[]>`select capacity,member_price_cents,non_member_price_cents,status,title from idoc.seminars where id=${id} for update`;
    if (!existing) throw new SeminarValidationError('Seminar not found.');
    const [{ count: activeCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.seminar_registrations where seminar_id=${id} and registration_status='registered'`;
    const [{ count: totalCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.seminar_registrations where seminar_id=${id}`;
    if (totalCount > 0 && (fields.memberPriceCents !== existing.member_price_cents || fields.nonMemberPriceCents !== existing.non_member_price_cents)) {
      throw new SeminarValidationError('Prices cannot change once a seminar has registrations.');
    }
    if (fields.capacity < activeCount) {
      throw new SeminarValidationError(`Capacity cannot be reduced below the ${activeCount} current active registration(s).`);
    }
    await sql`update idoc.seminars set title=${fields.title},description='',start_date=${fields.startDate},end_date=${fields.endDate},location=${fields.location},
      language=${fields.language},organizing_national_federation=${fields.organizingNationalFederation},course_directors=${fields.courseDirectors},
      participant_profile=${fields.participantProfile},course_venue_information=${fields.courseVenueInformation},application=${fields.application},accommodation_information=${fields.accommodationInformation},
      capacity=${fields.capacity},member_price_cents=${fields.memberPriceCents},non_member_price_cents=${fields.nonMemberPriceCents},
      registration_deadline=${iso(fields.registrationDeadline)},status=${fields.status},is_fei=${fields.isFei},levels=${sql.array(fields.levels)},
      updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    // Canceling a seminar atomically cancels active registrations. Stripe resolution is intentionally
    // outside this request: the five-minute cancellation worker treats the resulting canceled online
    // registration state as a durable queue, so refunds/session expiry survive request termination.
    let canceledRegistrations = 0;
    if (existing.status !== 'canceled' && fields.status === 'canceled') {
      const canceled = await sql<{ id: number }[]>`update idoc.seminar_registrations set registration_status='canceled',canceled_at=now(),updated_at=now()
        where seminar_id=${id} and registration_status='registered' returning id`;
      canceledRegistrations = canceled.length;
      if (canceledRegistrations) {
        await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values
          (${actor.id},'admin.seminar.registrations_canceled_by_cascade','seminar',${String(id)},${JSON.stringify({ registrationIds: canceled.map((row) => row.id) })}::jsonb)`;
      }
    }
    const changedFields = [
      existing.title !== fields.title && 'title', existing.status !== fields.status && 'status',
      existing.capacity !== fields.capacity && 'capacity', existing.member_price_cents !== fields.memberPriceCents && 'memberPriceCents',
      existing.non_member_price_cents !== fields.nonMemberPriceCents && 'nonMemberPriceCents',
    ].filter(Boolean);
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
      (${actor.id},'admin.seminar.edited','seminar',${String(id)},
      ${JSON.stringify({ capacity: existing.capacity, memberPriceCents: existing.member_price_cents, nonMemberPriceCents: existing.non_member_price_cents, status: existing.status, title: existing.title })}::jsonb,
      ${JSON.stringify({ canceledRegistrations, capacity: fields.capacity, changedFields, memberPriceCents: fields.memberPriceCents, nonMemberPriceCents: fields.nonMemberPriceCents, status: fields.status, title: fields.title })}::jsonb)`;
  });
}

export { seminarEndsAtUtc };
