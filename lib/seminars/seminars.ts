import 'server-only';

import { z } from 'zod';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { seminarEndsAtUtc, SEMINAR_STATUSES, type SeminarStatus } from '@/lib/seminars/status';
import { isValidIanaTimeZone, zonedDateTimeToUtc } from '@/lib/seminars/timezone';

export { SEMINAR_STATUSES, type SeminarStatus } from '@/lib/seminars/status';

export const SEMINAR_TITLE_MAX_LENGTH = 200;
export const SEMINAR_DESCRIPTION_MAX_LENGTH = 10_000;
export const SEMINAR_LOCATION_MAX_LENGTH = 2000;
export const SEMINAR_MAX_PRICE_CENTS = 100_000_00;
const ADMIN_PAGE_SIZE = 20;

export class SeminarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeminarValidationError';
  }
}

const titleSchema = z.string().trim().min(1).max(SEMINAR_TITLE_MAX_LENGTH);
const descriptionSchema = z.string().trim().min(1).max(SEMINAR_DESCRIPTION_MAX_LENGTH);
const locationSchema = z.string().trim().min(1).max(SEMINAR_LOCATION_MAX_LENGTH);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
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
  capacity: unknown; description: unknown; endTime: unknown; location: unknown; paymentMethodId: unknown;
  price: unknown; registrationDeadline: unknown; seminarDate: unknown; startTime: unknown; status: unknown;
  timezone: unknown; title: unknown;
};

function validateFields(input: SeminarInput) {
  const title = parse(titleSchema, input.title, 'Title is required and must be 200 characters or fewer.');
  const description = parse(descriptionSchema, input.description, 'Description is required and must be 10,000 characters or fewer.');
  const location = parse(locationSchema, input.location, 'Location or meeting link is required and must be 2,000 characters or fewer.');
  const seminarDate = parse(dateSchema, input.seminarDate, 'Enter a valid seminar date.');
  const startTime = parse(timeSchema, input.startTime, 'Enter a valid start time.');
  const endTime = parse(timeSchema, input.endTime, 'Enter a valid end time.');
  if (endTime <= startTime) throw new SeminarValidationError('End time must be after start time.');
  const timezone = typeof input.timezone === 'string' ? input.timezone.trim() : '';
  if (!isValidIanaTimeZone(timezone)) throw new SeminarValidationError('Choose a valid timezone.');
  const capacity = parse(capacitySchema, input.capacity, 'Capacity must be a whole number of at least 1.');
  const price = parse(priceSchema, input.price, 'Price must be zero or a positive amount.');
  const priceCents = Math.round(price * 100);
  const status = parse(statusSchema, input.status, 'Choose a valid publication status.');
  const deadlineIso = parse(isoDateTimeSchema, input.registrationDeadline, 'Enter a valid registration deadline.');
  const registrationDeadline = parseDeadlineAsUtc(deadlineIso);
  const startsAtUtc = zonedDateTimeToUtc(seminarDate, startTime, timezone);
  if (registrationDeadline.getTime() > startsAtUtc.getTime()) {
    throw new SeminarValidationError('The registration deadline must be at or before the seminar start time.');
  }
  const paymentMethodId = typeof input.paymentMethodId === 'string' ? input.paymentMethodId.trim() : '';
  if (!['online_stripe', 'bank_transfer', 'cash_event'].includes(paymentMethodId)) {
    throw new SeminarValidationError('Choose a valid payment method.');
  }
  return { capacity, description, endTime, location, paymentMethodId, priceCents, registrationDeadline, seminarDate, startTime, status, timezone, title };
}

/** Any Administrator (not only Super Admin) may read which seminar payment methods are currently
 * enabled to choose one for a seminar; only Organization Settings (Super Admin only) may change
 * which methods are enabled or edit Bank Transfer instructions. */
export async function listEnabledSeminarPaymentMethods() {
  await requireSeminarAdministrator();
  return client<{ canonical_id: string; display_label: string }[]>`select canonical_id,display_label from idoc.seminar_payment_methods where enabled=true order by display_order`;
}

export async function listAdminSeminars(input: Record<string, string | string[] | undefined>) {
  await requireSeminarAdministrator();
  const firstValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const page = Math.max(1, Number.parseInt(firstValue(input.page) ?? '1', 10) || 1);
  const statusValue = firstValue(input.status);
  const status: SeminarStatus | null = SEMINAR_STATUSES.includes(statusValue as SeminarStatus) ? (statusValue as SeminarStatus) : null;
  const search = (firstValue(input.q) ?? '').trim().slice(0, 100);
  const limit = ADMIN_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const rows = await client`select s.id,s.title,s.status,s.seminar_date,s.start_time,s.capacity,s.payment_method_canonical_id,
    (select count(*)::int from idoc.seminar_registrations r where r.seminar_id=s.id and r.registration_status='registered') registered_count
    from idoc.seminars s
    where (${status}::text is null or s.status=${status}) and (${search}='' or s.title ilike ${`%${search}%`} or s.location ilike ${`%${search}%`})
    order by s.seminar_date desc, s.id desc limit ${limit + 1} offset ${offset}`;
  return { hasNext: rows.length > limit, page, rows: rows.slice(0, limit) };
}

export type AdminSeminarRow = {
  capacity: number; created_at: Date; created_by_user_id: number; description: string; end_time: string; id: number;
  location: string; payment_method_canonical_id: string; price_cents: number; registration_deadline: Date | string;
  seminar_date: string; start_time: string; status: SeminarStatus; timezone: string; title: string; updated_at: Date; updated_by_user_id: number;
};
export async function getAdminSeminar(value: unknown): Promise<AdminSeminarRow | null> {
  await requireSeminarAdministrator();
  const parsedId = idSchema.safeParse(value);
  if (!parsedId.success) return null;
  const [row] = await client<AdminSeminarRow[]>`select * from idoc.seminars where id=${parsedId.data} limit 1`;
  return row ?? null;
}

export async function createSeminar(input: SeminarInput) {
  const actor = await requireSeminarAdministrator();
  const fields = validateFields(input);
  return client.begin(async (sql) => {
    const [enabledMethod] = await sql<{ enabled: boolean }[]>`select enabled from idoc.seminar_payment_methods where canonical_id=${fields.paymentMethodId} limit 1`;
    if (!enabledMethod?.enabled) throw new SeminarValidationError('The selected payment method is not currently enabled in Organization Settings.');
    const [row] = await sql<{ id: number }[]>`insert into idoc.seminars
      (title,description,seminar_date,start_time,end_time,timezone,location,capacity,price_cents,registration_deadline,status,payment_method_canonical_id,created_by_user_id,updated_by_user_id)
      values (${fields.title},${fields.description},${fields.seminarDate},${fields.startTime},${fields.endTime},${fields.timezone},${fields.location},${fields.capacity},${fields.priceCents},${iso(fields.registrationDeadline)},${fields.status},${fields.paymentMethodId},${actor.id},${actor.id})
      returning id`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values
      (${actor.id},'admin.seminar.created','seminar',${String(row.id)},${JSON.stringify({ capacity: fields.capacity, paymentMethodId: fields.paymentMethodId, status: fields.status, title: fields.title })}::jsonb)`;
    return row.id;
  });
}

export async function updateSeminar(idValue: unknown, input: SeminarInput) {
  const actor = await requireSeminarAdministrator();
  const id = parse(idSchema, idValue, 'Seminar not found.');
  const fields = validateFields(input);
  await client.begin(async (sql) => {
    const [existing] = await sql<{
      capacity: number; payment_method_canonical_id: string; price_cents: number; status: SeminarStatus; title: string;
    }[]>`select capacity,payment_method_canonical_id,price_cents,status,title from idoc.seminars where id=${id} for update`;
    if (!existing) throw new SeminarValidationError('Seminar not found.');
    const [{ count: activeCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.seminar_registrations where seminar_id=${id} and registration_status='registered'`;
    const [{ count: totalCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.seminar_registrations where seminar_id=${id}`;
    if (totalCount > 0) {
      if (fields.paymentMethodId !== existing.payment_method_canonical_id) {
        throw new SeminarValidationError('The payment method cannot change once a seminar has registrations.');
      }
      if (fields.priceCents !== existing.price_cents) {
        throw new SeminarValidationError('The price cannot change once a seminar has registrations.');
      }
    } else if (fields.paymentMethodId !== existing.payment_method_canonical_id) {
      const [enabledMethod] = await sql<{ enabled: boolean }[]>`select enabled from idoc.seminar_payment_methods where canonical_id=${fields.paymentMethodId} limit 1`;
      if (!enabledMethod?.enabled) throw new SeminarValidationError('The selected payment method is not currently enabled in Organization Settings.');
    }
    if (fields.capacity < activeCount) {
      throw new SeminarValidationError(`Capacity cannot be reduced below the ${activeCount} current active registration(s).`);
    }
    await sql`update idoc.seminars set title=${fields.title},description=${fields.description},seminar_date=${fields.seminarDate},
      start_time=${fields.startTime},end_time=${fields.endTime},timezone=${fields.timezone},location=${fields.location},
      capacity=${fields.capacity},registration_deadline=${iso(fields.registrationDeadline)},status=${fields.status},
      updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    const changedFields = [
      existing.title !== fields.title && 'title', existing.status !== fields.status && 'status',
      existing.capacity !== fields.capacity && 'capacity', existing.payment_method_canonical_id !== fields.paymentMethodId && 'paymentMethodId',
      existing.price_cents !== fields.priceCents && 'priceCents',
    ].filter(Boolean);
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
      (${actor.id},'admin.seminar.edited','seminar',${String(id)},
      ${JSON.stringify({ capacity: existing.capacity, paymentMethodId: existing.payment_method_canonical_id, priceCents: existing.price_cents, status: existing.status, title: existing.title })}::jsonb,
      ${JSON.stringify({ changedFields, capacity: fields.capacity, paymentMethodId: fields.paymentMethodId, priceCents: fields.priceCents, status: fields.status, title: fields.title })}::jsonb)`;
  });
}

export async function setSeminarStatus(idValue: unknown, statusValue: unknown) {
  const actor = await requireSeminarAdministrator();
  const id = parse(idSchema, idValue, 'Seminar not found.');
  const status = parse(statusSchema, statusValue, 'Choose a valid publication status.');
  await client.begin(async (sql) => {
    const [existing] = await sql<{ status: SeminarStatus }[]>`select status from idoc.seminars where id=${id} for update`;
    if (!existing) throw new SeminarValidationError('Seminar not found.');
    if (existing.status === status) return;
    await sql`update idoc.seminars set status=${status},updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
      (${actor.id},'admin.seminar.status_changed','seminar',${String(id)},${JSON.stringify({ status: existing.status })}::jsonb,${JSON.stringify({ status })}::jsonb)`;
  });
}

export { seminarEndsAtUtc };
