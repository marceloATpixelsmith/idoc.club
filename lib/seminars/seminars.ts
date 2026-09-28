import 'server-only';
import { advancedListWhere, listDate, listOrder, listPage, listPageSize } from '@/lib/admin/resource-list-query';

import { z } from 'zod';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { refundSeminarRegistration } from '@/lib/payments/refunds';
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
  capacity: unknown; description: unknown; endTime: unknown; location: unknown;
  price: unknown; registrationDeadline: unknown; seminarDate: unknown; startTime: unknown; status: unknown;
  title: unknown;
};

function validateFields(input: SeminarInput) {
  const title = parse(titleSchema, input.title, 'Title is required and must be 200 characters or fewer.');
  const description = parse(descriptionSchema, input.description, 'Description is required and must be 10,000 characters or fewer.');
  const location = parse(locationSchema, input.location, 'Location or meeting link is required and must be 2,000 characters or fewer.');
  const seminarDate = parse(dateSchema, input.seminarDate, 'Enter a valid seminar date.');
  const startTime = parse(timeSchema, input.startTime, 'Enter a valid start time.');
  const endTime = parse(timeSchema, input.endTime, 'Enter a valid end time.');
  if (endTime <= startTime) throw new SeminarValidationError('End time must be after start time.');
  const capacity = parse(capacitySchema, input.capacity, 'Capacity must be a whole number of at least 1.');
  const price = parse(priceSchema, input.price, 'Price must be zero or a positive amount.');
  const priceCents = Math.round(price * 100);
  const status = parse(statusSchema, input.status, 'Choose a valid publication status.');
  const deadlineIso = parse(isoDateTimeSchema, input.registrationDeadline, 'Enter a valid registration deadline.');
  const registrationDeadline = parseDeadlineAsUtc(deadlineIso);
  const startsAtUtc = seminarEndsAtUtc({ seminarDate, endTime: startTime });
  if (registrationDeadline.getTime() > startsAtUtc.getTime()) {
    throw new SeminarValidationError('The registration deadline must be at or before the seminar start time.');
  }
  return { capacity, description, endTime, location, priceCents, registrationDeadline, seminarDate, startTime, status, title };
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
  const page = listPage(input);
  const statusValue = firstValue(input.status);
  const status: SeminarStatus | null = SEMINAR_STATUSES.includes(statusValue as SeminarStatus) ? (statusValue as SeminarStatus) : null;
  const search = (firstValue(input.q) ?? '').trim().slice(0, 100);
  const fromValue = firstValue(input.from) ?? '';
  const toValue = firstValue(input.to) ?? '';
  const from = listDate(fromValue);
  const to = listDate(toValue);
  const order = listOrder(input, {
    date: 's.seminar_date', title: 's.title', status: 's.status',
    registrations: '(select count(*) from idoc.seminar_registrations r where r.seminar_id=s.id and r.registration_status=\'registered\')',
  }, 'date', 's.id');
  const advancedWhere = advancedListWhere(input, { title: 's.title', status: 's.status' }, SEMINAR_STATUSES);
  const limit = listPageSize(input);
  const offset = (page - 1) * limit;
  const rows = await client`select s.id,s.title,s.status,s.seminar_date,s.start_time,s.capacity,count(*) over()::int total_count,
    (select count(*)::int from idoc.seminar_registrations r where r.seminar_id=s.id and r.registration_status='registered') registered_count
    from idoc.seminars s
    where (${status}::text is null or s.status=${status}) and (${search}='' or s.title ilike ${`%${search}%`} or s.location ilike ${`%${search}%`})
    and (${from}::date is null or s.seminar_date>=${from}::date) and (${to}::date is null or s.seminar_date<=${to}::date) and (${advancedWhere})
    order by ${order} limit ${limit + 1} offset ${offset}`;
  return { hasNext: rows.length > limit, page, pageSize: limit, rows: rows.slice(0, limit), total: Number(rows[0]?.total_count ?? 0) };
}

export type AdminSeminarRow = {
  capacity: number; created_at: Date; created_by_user_id: number; description: string; end_time: string; id: number;
  location: string; price_cents: number; registration_deadline: Date | string;
  seminar_date: string; start_time: string; status: SeminarStatus; title: string; updated_at: Date; updated_by_user_id: number;
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
    const [row] = await sql<{ id: number }[]>`insert into idoc.seminars
      (title,description,seminar_date,start_time,end_time,location,capacity,price_cents,registration_deadline,status,created_by_user_id,updated_by_user_id)
      values (${fields.title},${fields.description},${fields.seminarDate},${fields.startTime},${fields.endTime},${fields.location},${fields.capacity},${fields.priceCents},${iso(fields.registrationDeadline)},${fields.status},${actor.id},${actor.id}) returning id`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values
      (${actor.id},'admin.seminar.created','seminar',${String(row.id)},${JSON.stringify({ capacity: fields.capacity, status: fields.status, title: fields.title })}::jsonb)`;
    return row.id;
  });
}

export async function updateSeminar(idValue: unknown, input: SeminarInput) {
  const actor = await requireSeminarAdministrator();
  const id = parse(idSchema, idValue, 'Seminar not found.');
  const fields = validateFields(input);
  await client.begin(async (sql) => {
    const [existing] = await sql<{
      capacity: number; price_cents: number; status: SeminarStatus; title: string;
    }[]>`select capacity,price_cents,status,title from idoc.seminars where id=${id} for update`;
    if (!existing) throw new SeminarValidationError('Seminar not found.');
    const [{ count: activeCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.seminar_registrations where seminar_id=${id} and registration_status='registered'`;
    const [{ count: totalCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.seminar_registrations where seminar_id=${id}`;
    if (totalCount > 0) {
      if (fields.priceCents !== existing.price_cents) {
        throw new SeminarValidationError('The price cannot change once a seminar has registrations.');
      }
    }
    if (fields.capacity < activeCount) {
      throw new SeminarValidationError(`Capacity cannot be reduced below the ${activeCount} current active registration(s).`);
    }
    await sql`update idoc.seminars set title=${fields.title},description=${fields.description},seminar_date=${fields.seminarDate},
      start_time=${fields.startTime},end_time=${fields.endTime},location=${fields.location},
      capacity=${fields.capacity},registration_deadline=${iso(fields.registrationDeadline)},status=${fields.status},
      updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    const changedFields = [
      existing.title !== fields.title && 'title', existing.status !== fields.status && 'status',
      existing.capacity !== fields.capacity && 'capacity',
      existing.price_cents !== fields.priceCents && 'priceCents',
    ].filter(Boolean);
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
      (${actor.id},'admin.seminar.edited','seminar',${String(id)},
      ${JSON.stringify({ capacity: existing.capacity, priceCents: existing.price_cents, status: existing.status, title: existing.title })}::jsonb,
      ${JSON.stringify({ changedFields, capacity: fields.capacity, priceCents: fields.priceCents, status: fields.status, title: fields.title })}::jsonb)`;
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

/** Cancels the seminar first, then settles each active registration. Stripe attempts use the
 * existing durable refund/idempotency ledger; failures remain canceled/refund_failed and can be
 * retried by an administrator without consuming capacity or duplicating a refund. */
export async function cancelSeminar(idValue: unknown): Promise<{ failedRefunds: number }> {
  const actor = await requireSeminarAdministrator();
  const id = parse(idSchema, idValue, 'Seminar not found.');
  const stripeRegistrationIds = await client.begin(async (sql) => {
    const [existing] = await sql<{ status: SeminarStatus }[]>`select status from idoc.seminars where id=${id} for update`;
    if (!existing) throw new SeminarValidationError('Seminar not found.');
    await sql`update idoc.seminars set status='canceled',updated_by_user_id=${actor.id},updated_at=now() where id=${id}`;
    const registrations = await sql<{ id: number; payment_method_canonical_id: string; payment_status: string; registration_status: string }[]>`select id,payment_method_canonical_id,payment_status,registration_status from idoc.seminar_registrations where seminar_id=${id} and (registration_status='registered' or (registration_status='canceled' and payment_status='refund_failed')) for update`;
    for (const registration of registrations) {
      if (registration.payment_status === 'refunded') {
        await sql`update idoc.seminar_registrations set registration_status='refunded',refunded_at=coalesce(refunded_at,now()),updated_at=now() where id=${registration.id}`;
      } else {
        await sql`update idoc.seminar_registrations set registration_status='canceled',canceled_at=coalesce(canceled_at,now()),updated_at=now() where id=${registration.id}`;
      }
      await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values(${actor.id},'admin.seminar_registration.canceled_with_seminar','seminar_registration',${String(registration.id)},${JSON.stringify({ paymentStatus: registration.payment_status, registrationStatus: registration.registration_status })}::jsonb,${JSON.stringify({ paymentStatus: registration.payment_status, registrationStatus: registration.payment_status === 'refunded' ? 'refunded' : 'canceled' })}::jsonb)`;
    }
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values(${actor.id},'admin.seminar.canceled','seminar',${String(id)},${JSON.stringify({ status: existing.status })}::jsonb,'{"status":"canceled"}'::jsonb)`;
    return registrations.filter((r) => r.payment_method_canonical_id === 'online_stripe' && ['paid','refund_failed'].includes(r.payment_status)).map((r) => r.id);
  });
  let failedRefunds = 0;
  for (const registrationId of stripeRegistrationIds) {
    try { await refundSeminarRegistration(registrationId, 'Seminar canceled by administrator'); } catch { failedRefunds += 1; }
  }
  return { failedRefunds };
}

export { seminarEndsAtUtc };
