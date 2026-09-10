import 'server-only';

import { z } from 'zod';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { computeSeminarAvailability, initialPaymentStatusForMethod, PAYMENT_STATUSES, REGISTRATION_STATUSES, type PaymentStatus } from '@/lib/seminars/status';

const idSchema = z.coerce.number().int().positive();
const REGISTRATION_EXPORT_LIMIT = 25_000;

export class SeminarRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeminarRegistrationError';
  }
}

async function requireSeminarAdministrator() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return actor;
}

/** Bank Transfer instructions are the same organization-wide, already-sanitized rich text Super
 * Admins maintain at /admin/organization (docs/05 -- sanitizeBankInstructions runs at write time
 * there); a seminar never stores or edits its own copy. Any authenticated member may read it once
 * they need to know how to pay -- it carries no administrative or payment-configuration data. */
export async function getSeminarPaymentMethodInstructions(canonicalId: string): Promise<string | null> {
  const [row] = await client<{ instructions_html: string | null }[]>`select instructions_html from idoc.seminar_payment_methods where canonical_id=${canonicalId} limit 1`;
  return row?.instructions_html ?? null;
}

async function requireOwnProfileId(): Promise<{ actorId: number; profileId: number }> {
  const actor = await requireAccountAccess('member');
  const [profile] = await client<{ id: number }[]>`select id from idoc.profiles where user_id=${actor.id} limit 1`;
  if (!profile) throw new SeminarRegistrationError('A member profile is required to register for seminars.');
  return { actorId: actor.id, profileId: profile.id };
}

type SeminarAvailabilityRow = {
  capacity: number; description: string; end_time: string; ends_at: Date | string; id: number; location: string;
  payment_method_canonical_id: string; payment_status: PaymentStatus | null; price_cents: number; registered_at: Date | string | null;
  registered_count: number; registration_deadline: Date | string; registration_status: 'canceled' | 'registered' | null;
  seminar_date: string; start_time: string; status: 'canceled' | 'draft' | 'published'; timezone: string; title: string;
};
function withAvailability(row: SeminarAvailabilityRow) {
  return {
    ...row,
    availability: computeSeminarAvailability({
      activeRegistrationCount: row.registered_count, capacity: row.capacity, endsAtUtc: new Date(row.ends_at),
      registrationDeadline: row.registration_deadline, status: row.status,
    }),
  };
}

/** "Current" seminars: every published, not-yet-past seminar (a browsable catalog, whether or not
 * this member is registered) plus any not-yet-past seminar this member has a registration for
 * regardless of its current publication state (e.g. one the administrator later canceled). */
export async function listCurrentSeminarsForMember(profileId: number | null) {
  const rows = await client<SeminarAvailabilityRow[]>`select s.id,s.title,s.description,s.seminar_date,s.start_time,s.end_time,s.timezone,s.location,
    s.capacity,s.price_cents,s.registration_deadline,s.status,s.payment_method_canonical_id,
    (s.seminar_date + s.end_time) at time zone s.timezone ends_at,
    (select count(*)::int from idoc.seminar_registrations x where x.seminar_id=s.id and x.registration_status='registered') registered_count,
    r.registration_status,r.payment_status,r.registered_at
    from idoc.seminars s left join idoc.seminar_registrations r on r.seminar_id=s.id and r.profile_id=${profileId}
    where (s.status='published' or r.id is not null)
    and (s.seminar_date + s.end_time) at time zone s.timezone > now()
    order by s.seminar_date,s.start_time`;
  return rows.map(withAvailability);
}

/** "Past" seminars: this member's own registration history only -- not a general public archive. */
export async function listPastSeminarsForMember(profileId: number) {
  const rows = await client<SeminarAvailabilityRow[]>`select s.id,s.title,s.description,s.seminar_date,s.start_time,s.end_time,s.timezone,s.location,
    s.capacity,s.price_cents,s.registration_deadline,s.status,s.payment_method_canonical_id,
    (s.seminar_date + s.end_time) at time zone s.timezone ends_at,
    (select count(*)::int from idoc.seminar_registrations x where x.seminar_id=s.id and x.registration_status='registered') registered_count,
    r.registration_status,r.payment_status,r.registered_at
    from idoc.seminars s join idoc.seminar_registrations r on r.seminar_id=s.id and r.profile_id=${profileId}
    where (s.seminar_date + s.end_time) at time zone s.timezone <= now()
    order by s.seminar_date desc,s.start_time desc`;
  return rows.map(withAvailability);
}

/** Member-centric registration history for the administrator member detail view. */
export async function listAdminSeminarHistoryForMember(profileIdValue: unknown) {
  await requireSeminarAdministrator();
  const profileId = idSchema.safeParse(profileIdValue);
  if (!profileId.success) return [];
  return client<{
    id: number; location: string; paymentStatus: string; registeredAt: Date | string;
    registrationStatus: string; seminarDate: string; seminarStatus: string; title: string;
  }[]>`select s.id,s.title,s.seminar_date "seminarDate",s.location,s.status "seminarStatus",
    r.registration_status "registrationStatus",r.payment_status "paymentStatus",r.registered_at "registeredAt"
    from idoc.seminar_registrations r join idoc.seminars s on s.id=r.seminar_id
    where r.profile_id=${profileId.data} order by s.seminar_date desc,s.start_time desc,s.id desc`;
}

/** Registers the authenticated member for a seminar, atomically enforcing capacity and duplicate
 * prevention under a row lock on the seminar itself -- two concurrent registration attempts for the
 * last open seat serialize on this lock, so exactly one succeeds. Canceling and re-registering
 * reuses the same row (the unique (seminar_id, profile_id) index is a permanent guard, not just a
 * point-in-time check), which resets payment evidence for a fresh registration cycle. */
export async function registerForSeminar(seminarIdValue: unknown): Promise<{ paymentMethod: string; registrationId: number }> {
  const { profileId } = await requireOwnProfileId();
  const seminarId = idSchema.safeParse(seminarIdValue);
  if (!seminarId.success) throw new SeminarRegistrationError('Seminar not found.');
  return client.begin(async (sql) => {
    const [seminar] = await sql<{
      capacity: number; ends_at: Date; payment_method_canonical_id: string; registration_deadline: Date; status: string;
    }[]>`select capacity,payment_method_canonical_id,registration_deadline,status,
      (seminar_date + end_time) at time zone timezone ends_at from idoc.seminars where id=${seminarId.data} for update`;
    if (!seminar || seminar.status !== 'published') throw new SeminarRegistrationError('This seminar is not open for registration.');
    const now = new Date();
    if (now > new Date(seminar.registration_deadline) || now >= new Date(seminar.ends_at)) {
      throw new SeminarRegistrationError('Registration for this seminar is closed.');
    }
    const [{ count: activeCount }] = await sql<{ count: number }[]>`select count(*)::int count from idoc.seminar_registrations
      where seminar_id=${seminarId.data} and registration_status='registered'`;
    const [existing] = await sql<{ id: number; payment_status: string; registration_status: string }[]>`select id,registration_status,payment_status from idoc.seminar_registrations
      where seminar_id=${seminarId.data} and profile_id=${profileId} for update`;
    if (existing?.registration_status === 'registered') throw new SeminarRegistrationError('You are already registered for this seminar.');
    if (existing && !['unpaid', 'bank_transfer_pending', 'cash_pending'].includes(existing.payment_status)) {
      throw new SeminarRegistrationError('This registration has payment history and cannot be reactivated. Contact an administrator.');
    }
    if (activeCount >= seminar.capacity) throw new SeminarRegistrationError('This seminar is full.');
    const paymentStatus = initialPaymentStatusForMethod(seminar.payment_method_canonical_id);
    let registrationId: number;
    if (existing) {
      await sql`update idoc.seminar_registrations set registration_status='registered',payment_status=${paymentStatus},
        stripe_checkout_session_id=null,checkout_status=null,checkout_created_at=null,expected_amount_cents=null,
        stripe_payment_intent_id=null,paid_at=null,marked_paid_by_user_id=null,payment_status_updated_at=now(),
        registered_at=now(),canceled_at=null,updated_at=now() where id=${existing.id}`;
      registrationId = existing.id;
    } else {
      const [row] = await sql<{ id: number }[]>`insert into idoc.seminar_registrations (seminar_id,profile_id,payment_status)
        values (${seminarId.data},${profileId},${paymentStatus}) returning id`;
      registrationId = row.id;
    }
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values
      (null,'member.seminar_registration.registered','seminar_registration',${String(registrationId)},${JSON.stringify({ profileId, seminarId: seminarId.data })}::jsonb)`;
    await sql`insert into idoc.notification_outbox(profile_id,kind,payload,dedupe_key) values
      (${profileId},'seminar.registration_created',(select jsonb_build_object('registrationId',${registrationId},'seminarId',${seminarId.data},'to',u.email,'firstName',p.first_name)
        from idoc.profiles p join idoc.users u on u.id=p.user_id where p.id=${profileId}),${`seminar.registration_created:${registrationId}:${Date.now()}`})`;
    return { paymentMethod: seminar.payment_method_canonical_id, registrationId };
  });
}

export async function cancelOwnRegistration(seminarIdValue: unknown): Promise<void> {
  const { profileId } = await requireOwnProfileId();
  const seminarId = idSchema.safeParse(seminarIdValue);
  if (!seminarId.success) throw new SeminarRegistrationError('Seminar not found.');
  await client.begin(async (sql) => {
    const [existing] = await sql<{ id: number; registration_status: string }[]>`select id,registration_status from idoc.seminar_registrations
      where seminar_id=${seminarId.data} and profile_id=${profileId} for update`;
    if (!existing || existing.registration_status === 'canceled') throw new SeminarRegistrationError('No active registration was found.');
    await sql`update idoc.seminar_registrations set registration_status='canceled',canceled_at=now(),updated_at=now() where id=${existing.id}`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id) values
      (null,'member.seminar_registration.canceled','seminar_registration',${String(existing.id)})`;
    await sql`insert into idoc.notification_outbox(profile_id,kind,payload,dedupe_key) values
      (${profileId},'seminar.registration_canceled',(select jsonb_build_object('registrationId',${existing.id},'seminarId',${seminarId.data},'to',u.email,'firstName',p.first_name)
        from idoc.profiles p join idoc.users u on u.id=p.user_id where p.id=${profileId}),${`seminar.registration_canceled:${existing.id}:${Date.now()}`})`;
  });
}

export async function markRegistrationPaymentReceived(registrationIdValue: unknown): Promise<void> {
  const actor = await requireSeminarAdministrator();
  const registrationId = idSchema.safeParse(registrationIdValue);
  if (!registrationId.success) throw new SeminarRegistrationError('Registration not found.');
  await client.begin(async (sql) => {
    const [existing] = await sql<{ payment_status: PaymentStatus }[]>`select payment_status from idoc.seminar_registrations where id=${registrationId.data} for update`;
    if (!existing) throw new SeminarRegistrationError('Registration not found.');
    if (existing.payment_status === 'paid') return;
    await sql`update idoc.seminar_registrations set payment_status='paid',paid_at=now(),marked_paid_by_user_id=${actor.id},updated_at=now() where id=${registrationId.data}`;
    await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json) values
      (${actor.id},'admin.seminar_registration.payment_marked_paid','seminar_registration',${String(registrationId.data)},${JSON.stringify({ paymentStatus: existing.payment_status })}::jsonb)`;
  });
}

export async function listAdminSeminarRegistrations(seminarIdValue: unknown, input: Record<string, string | string[] | undefined>) {
  await requireSeminarAdministrator();
  const seminarId = idSchema.safeParse(seminarIdValue);
  if (!seminarId.success) return { rows: [] };
  const firstValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const registrationStatusValue = firstValue(input.registrationStatus);
  const registrationStatus: string | null = REGISTRATION_STATUSES.includes(registrationStatusValue as never) ? (registrationStatusValue ?? null) : null;
  const paymentStatusValue = firstValue(input.paymentStatus);
  const paymentStatus: string | null = PAYMENT_STATUSES.includes(paymentStatusValue as never) ? (paymentStatusValue ?? null) : null;
  const search = (firstValue(input.q) ?? '').trim().slice(0, 100);
  const rows = await client`select r.id,r.registration_status,r.payment_status,r.registered_at,r.canceled_at,r.paid_at,
    p.id profile_id,coalesce(p.first_name||' '||p.last_name,'') member_name,coalesce(u.email_display,u.email) member_email
    from idoc.seminar_registrations r join idoc.profiles p on p.id=r.profile_id join idoc.users u on u.id=p.user_id
    where r.seminar_id=${seminarId.data}
    and (${registrationStatus}::text is null or r.registration_status=${registrationStatus})
    and (${paymentStatus}::text is null or r.payment_status=${paymentStatus})
    and (${search}='' or coalesce(p.first_name||' '||p.last_name,'') ilike ${`%${search}%`} or u.email ilike ${`%${search}%`})
    order by r.registered_at desc`;
  return { rows };
}

export async function exportSeminarRegistrationsCsvRows(seminarIdValue: unknown) {
  const actor = await requireSeminarAdministrator();
  const seminarId = idSchema.safeParse(seminarIdValue);
  if (!seminarId.success) throw new SeminarRegistrationError('Seminar not found.');
  const rows = await client`select s.title seminar_title,coalesce(p.first_name||' '||p.last_name,'') member_name,
    coalesce(u.email_display,u.email) member_email,r.registration_status,r.payment_status,r.expected_amount_cents,r.currency,
    r.registered_at,r.canceled_at,r.paid_at,
    (select string_agg(pr.external_refund_id, ';' order by pr.requested_at) from idoc.payment_refunds pr where pr.seminar_registration_id=r.id) refund_ids,
    (select coalesce(sum(pr.amount_cents) filter(where pr.status='succeeded'),0)::int from idoc.payment_refunds pr where pr.seminar_registration_id=r.id) refunded_amount_cents
    from idoc.seminar_registrations r join idoc.seminars s on s.id=r.seminar_id
    join idoc.profiles p on p.id=r.profile_id join idoc.users u on u.id=p.user_id
    where r.seminar_id=${seminarId.data} order by r.registered_at limit ${REGISTRATION_EXPORT_LIMIT + 1}`;
  if (rows.length > REGISTRATION_EXPORT_LIMIT) throw new SeminarRegistrationError(`Export exceeds the safe limit of ${REGISTRATION_EXPORT_LIMIT} registrations. Narrow the filters and retry.`);
  await client`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,after_json) values
    (${actor.id},'admin.seminar_registrations.exported','seminar',${String(seminarId.data)},${JSON.stringify({ resultCount: rows.length })}::jsonb)`;
  return rows;
}
