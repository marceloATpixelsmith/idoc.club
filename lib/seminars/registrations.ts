import 'server-only';
import { communicationHoldTimestamp, memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';

import type { TransactionSql } from 'postgres';
import { z } from 'zod';
import { advancedListWhere, listDate, listOrder, listPage, listPageSize, many } from '@/lib/admin/resource-list-query';
import { client } from '@/lib/db/drizzle';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { isEntitled } from '@/lib/membership/entitlement';
import { countryNameForCode } from '@/lib/membership/countries';
import { escapeHtml } from '@/lib/notifications/email-template';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { formatDate, formatLevels } from '@/lib/seminars/format';
import { languageNameForTag } from '@/lib/seminars/language';
import { guestEmailSchema, guestFirstNameSchema, guestLastNameSchema, guestPhoneSchema } from '@/lib/seminars/guest-registration-validation';
import { computeSeminarAvailability, initialPaymentStatusForMethod, PAYMENT_STATUSES, REGISTRATION_STATUSES, type PaymentStatus } from '@/lib/seminars/status';

const idSchema = z.coerce.number().int().positive();
const REGISTRATION_EXPORT_LIMIT = 25_000;
const MANUAL_PAYMENT_METHODS = ['bank_transfer', 'cash_event'] as const;

export function isStagingSeminarDirectDelivery(): boolean {
  try {
    return new URL(baseUrlForServer()).hostname === 'staging.club';
  } catch {
    return false;
  }
}

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
 * there); a seminar never stores or edits its own copy. Deliberately reachable by anyone, member or
 * guest, once they need to know how to pay -- it carries no administrative or payment-configuration
 * data. */
export async function getSeminarPaymentMethodInstructions(canonicalId: string): Promise<string | null> {
  const [row] = await client<{ instructions_html: string | null }[]>`select instructions_html from seminar_payment_methods where canonical_id=${canonicalId} limit 1`;
  return row?.instructions_html ?? null;
}

/** The set of payment methods a registrant -- member or guest -- may currently choose from.
 * Deliberately public (no auth): a signed-out visitor must see this before deciding whether to
 * register as a guest at all. */
export async function listEnabledSeminarPaymentMethods() {
  return client<{ canonical_id: string; display_label: string }[]>`select canonical_id,display_label from seminar_payment_methods where enabled=true order by display_order`;
}

/** Every canonical payment method, enabled or not -- for the admin registration-detail drawer's
 * select, which must still show and preserve a registration's own current method even if an
 * administrator has since disabled it in Organization Settings (see updateSeminarRegistrationDetails,
 * which allows keeping that same value even though it would fail validation as a new choice). */
export async function listAllSeminarPaymentMethodsForAdmin() {
  await requireSeminarAdministrator();
  return client<{ canonical_id: string; display_label: string }[]>`select canonical_id,display_label from seminar_payment_methods order by display_order`;
}

export async function createAdminSeminarRegistration(fields: {
  email?: unknown; firstName?: unknown; lastName?: unknown; paymentMethod?: unknown; phone?: unknown; seminarId?: unknown;
}): Promise<{ registrationId: number }> {
  const actor = await requireSeminarAdministrator();
  const seminarId = idSchema.safeParse(fields.seminarId);
  if (!seminarId.success) throw new SeminarRegistrationError('Choose a seminar.');
  const paymentMethod = z.enum(MANUAL_PAYMENT_METHODS).safeParse(fields.paymentMethod);
  if (!paymentMethod.success) throw new SeminarRegistrationError('Admin-created registrations must use Bank Transfer or Cash.');
  const enabledMethods = await listEnabledSeminarPaymentMethods();
  if (!enabledMethods.some((method) => method.canonical_id === paymentMethod.data)) {
    throw new SeminarRegistrationError('That payment method is currently disabled in Organization Settings.');
  }

  const emailResult = guestEmailSchema.safeParse(fields.email);
  if (!emailResult.success) throw new SeminarRegistrationError('Enter a valid email address.');
  const firstNameResult = guestFirstNameSchema.safeParse(fields.firstName);
  if (!firstNameResult.success) throw new SeminarRegistrationError('Enter a first name.');
  const lastNameResult = guestLastNameSchema.safeParse(fields.lastName);
  if (!lastNameResult.success) throw new SeminarRegistrationError('Enter a last name.');
  const phoneResult = guestPhoneSchema.safeParse(fields.phone);
  if (!phoneResult.success) throw new SeminarRegistrationError('Enter a valid phone number.');

  const email = emailResult.data.toLowerCase();
  const firstName = firstNameResult.data;
  const lastName = lastNameResult.data;
  const guestName = `${firstName} ${lastName}`;
  const directDelivery = isStagingSeminarDirectDelivery();

  return client.begin(async (sql) => {
    const seminar = await requireSeminarOpenForRegistration(sql, seminarId.data);
    const [member] = await sql<{ email: string; first_name: string; grace_ends_on: string | null; id: number; status: string | null; valid_until: string | null }[]>`select p.id,p.first_name,coalesce(u.email_display,u.email) email,
      m.status,m.valid_until,m.grace_ends_on
      from profiles p join users u on u.id=p.user_id
      left join lateral (
        select status,valid_until,grace_ends_on from memberships
        where profile_id=p.id order by updated_at desc,id desc limit 1
      ) m on true
      where lower(coalesce(u.email_display,u.email))=${email} limit 1`;

    const paymentStatus = initialPaymentStatusForMethod(paymentMethod.data);
    const memberEntitled = Boolean(member && member.status && member.valid_until && isEntitled({
      graceEndsOn: member.grace_ends_on,
      status: member.status,
      validUntil: member.valid_until,
    }, new Date().toISOString().slice(0, 10)));
    const priceCents = memberEntitled ? seminar.member_price_cents : seminar.non_member_price_cents;
    let registrationId: number;

    if (member) {
      const [existing] = await sql<{ id: number; payment_status: string; registration_status: string }[]>`select id,registration_status,payment_status
        from seminar_registrations where seminar_id=${seminarId.data} and profile_id=${member.id} for update`;
      if (existing?.registration_status === 'registered') throw new SeminarRegistrationError('This member is already registered for this seminar.');
      if (existing && !['unpaid', 'bank_transfer_pending', 'cash_pending'].includes(existing.payment_status)) {
        throw new SeminarRegistrationError('This registration has payment history and cannot be reactivated.');
      }
      if (existing) {
        await sql`update seminar_registrations set registration_status='registered',payment_status=${paymentStatus},
          payment_method_canonical_id=${paymentMethod.data},expected_amount_cents=${priceCents},currency='EUR',
          stripe_checkout_session_id=null,checkout_status=null,checkout_created_at=null,stripe_payment_intent_id=null,
          paid_at=null,marked_paid_by_user_id=null,payment_status_updated_at=now(),registered_at=now(),canceled_at=null,updated_at=now()
          where id=${existing.id}`;
        registrationId = existing.id;
      } else {
        const [row] = await sql<{ id: number }[]>`insert into seminar_registrations
          (seminar_id,profile_id,payment_status,payment_method_canonical_id,expected_amount_cents,currency)
          values (${seminarId.data},${member.id},${paymentStatus},${paymentMethod.data},${priceCents},'EUR') returning id`;
        registrationId = row.id;
      }
      const confirmationKind = directDelivery ? 'seminar.staging_registration_created' : 'seminar.registration_created';
      await sql`insert into notification_outbox(dead_lettered_at,last_error_code,profile_id,kind,payload,dedupe_key) values
        (${communicationHoldTimestamp()}::timestamptz,case when ${memberCommunicationsDisabled()} then 'member_launch_hold' else null end,${member.id},${confirmationKind},
          jsonb_build_object('amountCents',${priceCents}::int,'firstName',${member.first_name}::text,'paymentMethod',${paymentMethod.data}::text,'registrationId',${registrationId}::int,'seminarId',${seminarId.data}::int,'to',${member.email}::text),
          ${`seminar.registration_created:admin:${registrationId}:${Date.now()}`})`;
    } else {
      const [existing] = await sql<{ id: number; payment_status: string; registration_status: string }[]>`select id,registration_status,payment_status
        from seminar_registrations where seminar_id=${seminarId.data} and profile_id is null and lower(guest_email)=${email} for update`;
      if (existing?.registration_status === 'registered') throw new SeminarRegistrationError('This email is already registered for this seminar.');
      if (existing && !['unpaid', 'bank_transfer_pending', 'cash_pending'].includes(existing.payment_status)) {
        throw new SeminarRegistrationError('This registration has payment history and cannot be reactivated.');
      }
      if (existing) {
        await sql`update seminar_registrations set registration_status='registered',payment_status=${paymentStatus},
          payment_method_canonical_id=${paymentMethod.data},expected_amount_cents=${priceCents},currency='EUR',
          guest_name=${guestName},guest_first_name=${firstName},guest_last_name=${lastName},guest_phone=${phoneResult.data},guest_email=${email},
          stripe_checkout_session_id=null,checkout_status=null,checkout_created_at=null,stripe_payment_intent_id=null,
          paid_at=null,marked_paid_by_user_id=null,payment_status_updated_at=now(),registered_at=now(),canceled_at=null,updated_at=now()
          where id=${existing.id}`;
        registrationId = existing.id;
      } else {
        const [row] = await sql<{ id: number }[]>`insert into seminar_registrations
          (seminar_id,guest_name,guest_first_name,guest_last_name,guest_email,guest_phone,payment_status,payment_method_canonical_id,expected_amount_cents,currency)
          values (${seminarId.data},${guestName},${firstName},${lastName},${email},${phoneResult.data},${paymentStatus},${paymentMethod.data},${priceCents},'EUR') returning id`;
        registrationId = row.id;
      }
      const confirmationKind = directDelivery ? 'seminar.staging_registration_created' : 'seminar.registration_created';
      await sql`insert into notification_outbox(dead_lettered_at,last_error_code,profile_id,kind,payload,dedupe_key) values
        (${communicationHoldTimestamp()}::timestamptz,case when ${memberCommunicationsDisabled()} then 'member_launch_hold' else null end,null,${confirmationKind},jsonb_build_object('amountCents',${priceCents}::int,'firstName',${firstName}::text,'paymentMethod',${paymentMethod.data}::text,'registrationId',${registrationId}::int,'seminarId',${seminarId.data}::int,'to',${email}::text),
          ${`seminar.registration_created:admin:${registrationId}:${Date.now()}`})`;
    }

    await sql`insert into audit_log(actor_id,action,entity_type,entity_id,after_json) values
      (${actor.id},'admin.seminar_registration.created','seminar_registration',${String(registrationId)},
       ${JSON.stringify({ email, paymentMethod: paymentMethod.data, seminarId: seminarId.data })}::jsonb)`;
    return { registrationId };
  });
}

function validatePaymentMethod(rows: { canonical_id: string }[], value: unknown): string {
  const method = typeof value === 'string' ? value.trim() : '';
  if (!rows.some((row) => row.canonical_id === method)) throw new SeminarRegistrationError('Choose one of the currently accepted payment methods.');
  return method;
}

async function requireOwnProfileId(): Promise<{ actorId: number; profileId: number }> {
  const actor = await requireAccountAccess('member');
  const [profile] = await client<{ id: number }[]>`select id from profiles where user_id=${actor.id} limit 1`;
  if (!profile) throw new SeminarRegistrationError('A member profile is required to register for seminars.');
  return { actorId: actor.id, profileId: profile.id };
}

/** The looser counterpart to requireOwnProfileId: any signed-in account holder with a profile, not
 * just a currently entitled one -- registration and payment status are independent, durable facts
 * that outlive a lapsed membership (docs/02), so viewing/canceling/registering-at-the-non-member-price
 * must not itself require entitlement the way the member-price path (registerForSeminar) correctly
 * does. */
async function requireOwnProfileIdRegardlessOfEntitlement(): Promise<{ actorId: number; profileId: number }> {
  const actor = await requireAccountAccess('account');
  const [profile] = await client<{ id: number }[]>`select id from profiles where user_id=${actor.id} limit 1`;
  if (!profile) throw new SeminarRegistrationError('A member profile is required to register for seminars.');
  return { actorId: actor.id, profileId: profile.id };
}

type SeminarAvailabilityRow = {
  capacity: number; description: string; end_date: string; ends_at: Date | string; id: number; is_fei: boolean; levels: string[]; location: string;
  expected_amount_cents: number | null; member_price_cents: number; non_member_price_cents: number; payment_method_canonical_id: string | null; payment_status: PaymentStatus | null;
  registered_at: Date | string | null; registered_count: number; registration_deadline: Date | string; registration_status: 'canceled' | 'registered' | null;
  start_date: string; status: 'canceled' | 'draft' | 'published'; title: string;
  language: string; organizing_national_federation: string; course_directors: string; participant_profile: string; course_venue_information: string; application: string; accommodation_information: string;
};
function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function withAvailability(row: SeminarAvailabilityRow) {
  return {
    ...row,
    start_date: dateOnly(row.start_date),
    end_date: dateOnly(row.end_date),
    availability: computeSeminarAvailability({
      activeRegistrationCount: row.registered_count, capacity: row.capacity, endsAtUtc: new Date(row.ends_at),
      registrationDeadline: row.registration_deadline, status: row.status,
    }),
  };
}

/** "Current" seminars: every published, not-yet-past seminar (a browsable catalog, whether or not
 * this member is registered) plus any not-yet-past seminar this member has a registration for
 * regardless of its current publication state (e.g. one the administrator later canceled). A null
 * profileId (a signed-out visitor) simply never matches the left join, yielding the same public
 * catalog with no registration_status/payment_method_canonical_id attached to any row. */
export async function listCurrentSeminarsForMember(profileId: number | null) {
  const rows = await client<SeminarAvailabilityRow[]>`select s.id,s.title,s.description,s.start_date,s.end_date,s.location,s.language,s.organizing_national_federation,s.course_directors,s.participant_profile,s.course_venue_information,s.application,s.accommodation_information,
    s.capacity,s.member_price_cents,s.non_member_price_cents,s.registration_deadline,s.status,s.is_fei,s.levels,r.payment_method_canonical_id,r.expected_amount_cents,
    (s.end_date + 1)::timestamp ends_at,
    (select count(*)::int from seminar_registrations x where x.seminar_id=s.id and x.registration_status='registered') registered_count,
    r.registration_status,r.payment_status,r.registered_at
    from seminars s left join seminar_registrations r on r.seminar_id=s.id and r.profile_id=${profileId}
    where (s.status='published' or r.id is not null)
    and s.end_date >= current_date
    order by s.start_date,s.id`;
  return rows.map(withAvailability);
}

/** The public archive of already-ended, published seminars -- shown under a "Past seminars" heading
 * on the catalog (docs/08) so a visitor can see what IDOC has actually run, not just what's next.
 * Not member-scoped: registration is always closed for a past seminar regardless of who's viewing,
 * so there's nothing profile-specific to join in here (unlike listPastSeminarsForMember, which is
 * this member's own registration history). */
export async function listPastPublishedSeminars() {
  const rows = await client<SeminarAvailabilityRow[]>`select s.id,s.title,s.description,s.start_date,s.end_date,s.location,s.language,s.organizing_national_federation,s.course_directors,s.participant_profile,s.course_venue_information,s.application,s.accommodation_information,
    s.capacity,s.member_price_cents,s.non_member_price_cents,s.registration_deadline,s.status,s.is_fei,s.levels,
    null::varchar(40) payment_method_canonical_id,null::integer expected_amount_cents,
    (s.end_date + 1)::timestamp ends_at,
    (select count(*)::int from seminar_registrations x where x.seminar_id=s.id and x.registration_status='registered') registered_count,
    null::varchar(20) registration_status,null::varchar(30) payment_status,null::timestamptz registered_at
    from seminars s
    where s.status='published' and s.end_date < current_date
    order by s.start_date desc,s.id desc`;
  return rows.map(withAvailability);
}

/** One seminar's public detail (the /seminars/[id] page) -- the same visibility rule as
 * listCurrentSeminarsForMember (published, or one this profile has a registration for) but not
 * restricted to "not yet past", so a direct link to an already-ended seminar a member registered
 * for still resolves instead of 404ing. A null profileId (a signed-out visitor) simply never
 * matches the left join, the same public detail every visitor sees. */
export async function getSeminarForRegistrant(seminarIdValue: unknown, profileId: number | null) {
  const seminarId = idSchema.safeParse(seminarIdValue);
  if (!seminarId.success) return null;
  const [row] = await client<SeminarAvailabilityRow[]>`select s.id,s.title,s.description,s.start_date,s.end_date,s.location,s.language,s.organizing_national_federation,s.course_directors,s.participant_profile,s.course_venue_information,s.application,s.accommodation_information,
    s.capacity,s.member_price_cents,s.non_member_price_cents,s.registration_deadline,s.status,s.is_fei,s.levels,r.payment_method_canonical_id,r.expected_amount_cents,
    (s.end_date + 1)::timestamp ends_at,
    (select count(*)::int from seminar_registrations x where x.seminar_id=s.id and x.registration_status='registered') registered_count,
    r.registration_status,r.payment_status,r.registered_at
    from seminars s left join seminar_registrations r on r.seminar_id=s.id and r.profile_id=${profileId}
    where s.id=${seminarId.data} and (s.status='published' or r.id is not null) limit 1`;
  return row ? withAvailability(row) : null;
}

/** "Past" seminars: this member's own registration history only -- not a general public archive. */
export async function listPastSeminarsForMember(profileId: number) {
  const rows = await client<SeminarAvailabilityRow[]>`select s.id,s.title,s.description,s.start_date,s.end_date,s.location,s.language,s.organizing_national_federation,s.course_directors,s.participant_profile,s.course_venue_information,s.application,s.accommodation_information,
    s.capacity,s.member_price_cents,s.non_member_price_cents,s.registration_deadline,s.status,s.is_fei,s.levels,r.payment_method_canonical_id,r.expected_amount_cents,
    (s.end_date + 1)::timestamp ends_at,
    (select count(*)::int from seminar_registrations x where x.seminar_id=s.id and x.registration_status='registered') registered_count,
    r.registration_status,r.payment_status,r.registered_at
    from seminars s join seminar_registrations r on r.seminar_id=s.id and r.profile_id=${profileId}
    where s.end_date < current_date
    order by s.start_date desc,s.id desc`;
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
  }[]>`select s.id,s.title,s.start_date "seminarDate",s.location,s.status "seminarStatus",
    r.registration_status "registrationStatus",r.payment_status "paymentStatus",r.registered_at "registeredAt"
    from seminar_registrations r join seminars s on s.id=r.seminar_id
    where r.profile_id=${profileId.data} order by s.start_date desc,s.id desc,s.id desc`;
}

async function requireSeminarOpenForRegistration(sql: TransactionSql<Record<string, never>>, seminarId: number) {
  const [seminar] = await sql<{
    capacity: number; ends_at: Date; member_price_cents: number; non_member_price_cents: number; registration_deadline: Date; status: string;
  }[]>`select capacity,member_price_cents,non_member_price_cents,registration_deadline,status,
    (end_date + 1)::timestamp ends_at from seminars where id=${seminarId} for update`;
  if (!seminar || seminar.status !== 'published') throw new SeminarRegistrationError('This seminar is not open for registration.');
  const now = new Date();
  if (now > new Date(seminar.registration_deadline) || now >= new Date(seminar.ends_at)) {
    throw new SeminarRegistrationError('Registration for this seminar is closed.');
  }
  const [{ count: activeCount }] = await sql<{ count: number }[]>`select count(*)::int count from seminar_registrations
    where seminar_id=${seminarId} and registration_status='registered'`;
  if (activeCount >= seminar.capacity) throw new SeminarRegistrationError('This seminar is full.');
  return seminar;
}

/** Registers the authenticated member for a seminar, atomically enforcing capacity and duplicate
 * prevention under a row lock on the seminar itself -- two concurrent registration attempts for the
 * last open seat serialize on this lock, so exactly one succeeds. Canceling and re-registering
 * reuses the same row (the unique (seminar_id, profile_id) index is a permanent guard, not just a
 * point-in-time check), which resets payment evidence for a fresh registration cycle. The member
 * pays memberPriceCents -- always the lower of the seminar's two prices in practice, though nothing
 * here assumes that ordering. */
async function registerOwnProfileForSeminar(
  profileId: number, seminarIdValue: unknown, paymentMethodValue: unknown,
  priceFor: (seminar: { member_price_cents: number; non_member_price_cents: number }) => number,
): Promise<{ paymentMethod: string; registrationId: number }> {
  const seminarId = idSchema.safeParse(seminarIdValue);
  if (!seminarId.success) throw new SeminarRegistrationError('Seminar not found.');
  const enabledMethods = await listEnabledSeminarPaymentMethods();
  const paymentMethod = validatePaymentMethod(enabledMethods, paymentMethodValue);
  const directDelivery = isStagingSeminarDirectDelivery();
  const outcome = await client.begin(async (sql) => {
    const seminar = await requireSeminarOpenForRegistration(sql, seminarId.data);
    const priceCents = priceFor(seminar);
    const [existing] = await sql<{ id: number; payment_status: string; registration_status: string }[]>`select id,registration_status,payment_status from seminar_registrations
      where seminar_id=${seminarId.data} and profile_id=${profileId} for update`;
    if (existing?.registration_status === 'registered') throw new SeminarRegistrationError('You are already registered for this seminar.');
    if (existing && !['unpaid', 'bank_transfer_pending', 'cash_pending'].includes(existing.payment_status)) {
      throw new SeminarRegistrationError('This registration has payment history and cannot be reactivated. Contact an administrator.');
    }
    const paymentStatus = initialPaymentStatusForMethod(paymentMethod);
    let registrationId: number;
    if (existing) {
      await sql`update seminar_registrations set registration_status='registered',payment_status=${paymentStatus},
        payment_method_canonical_id=${paymentMethod},expected_amount_cents=${priceCents},currency='EUR',
        stripe_checkout_session_id=null,checkout_status=null,checkout_created_at=null,
        stripe_payment_intent_id=null,paid_at=null,marked_paid_by_user_id=null,payment_status_updated_at=now(),
        registered_at=now(),canceled_at=null,updated_at=now() where id=${existing.id}`;
      registrationId = existing.id;
    } else {
      const [row] = await sql<{ id: number }[]>`insert into seminar_registrations (seminar_id,profile_id,payment_status,payment_method_canonical_id,expected_amount_cents,currency)
        values (${seminarId.data},${profileId},${paymentStatus},${paymentMethod},${priceCents},'EUR') returning id`;
      registrationId = row.id;
    }
    await sql`insert into audit_log(actor_id,action,entity_type,entity_id,after_json) values
      (null,'member.seminar_registration.registered','seminar_registration',${String(registrationId)},${JSON.stringify({ profileId, seminarId: seminarId.data })}::jsonb)`;
    // Offline methods are confirmed at registration time. Online registrations wait until the
    // verified Stripe webhook marks the payment paid so the one confirmation email can truthfully
    // thank the registrant for the completed Stripe payment.
    if (paymentMethod !== 'online_stripe') {
      const confirmationKind = directDelivery ? 'seminar.staging_registration_created' : 'seminar.registration_created';
      await sql`insert into notification_outbox(dead_lettered_at,last_error_code,profile_id,kind,payload,dedupe_key) values
        (${communicationHoldTimestamp()}::timestamptz,case when ${memberCommunicationsDisabled()} then 'member_launch_hold' else null end,${profileId},${confirmationKind},(select jsonb_build_object('registrationId',${registrationId}::int,'seminarId',${seminarId.data}::int,'paymentMethod',${paymentMethod}::text,'amountCents',${priceCents}::int,'to',u.email::text,'firstName',p.first_name::text)
          from profiles p join users u on u.id=p.user_id where p.id=${profileId}),${`seminar.registration_created:${registrationId}:${Date.now()}`})`;
    }
    return { paymentMethod, registrationId };
  });
  return outcome;
}

export async function registerForSeminar(seminarIdValue: unknown, paymentMethodValue: unknown): Promise<{ paymentMethod: string; registrationId: number }> {
  const { profileId } = await requireOwnProfileId();
  return registerOwnProfileForSeminar(profileId, seminarIdValue, paymentMethodValue, (seminar) => seminar.member_price_cents);
}

/** Registers a signed-in visitor who has their own member profile but cannot use the member price
 * (a lapsed membership, most commonly) -- ties the registration to their real profileId rather than
 * a guest identity, so it correctly shows up in their own My Seminars, can be canceled the normal
 * way, and a repeat visit to the detail page correctly shows their existing registration instead of
 * the form again. Distinct from registerForSeminar (requires current entitlement, member price) and
 * registerAsGuestForSeminar (no profile to tie to at all -- a true anonymous visitor). */
export async function registerForSeminarAtNonMemberPrice(seminarIdValue: unknown, paymentMethodValue: unknown): Promise<{ paymentMethod: string; registrationId: number }> {
  const { profileId } = await requireOwnProfileIdRegardlessOfEntitlement();
  return registerOwnProfileForSeminar(profileId, seminarIdValue, paymentMethodValue, (seminar) => seminar.non_member_price_cents);
}

/** Registers an anonymous, non-member visitor at the seminar's non-member price -- no IDOC account
 * required. Mirrors registerForSeminar's capacity/deadline/duplicate guards exactly, scoped to a
 * guest identity (name + email) instead of a profileId; the partial unique index on
 * (seminar_id, lower(guest_email)) is the guest equivalent of the member unique-registration guard.
 * Guest confirmations use the same durable notification_outbox as profile registrations; guest rows
 * deliberately allow a null profileId and carry the recipient in the payload. The enqueue is part of
 * the registration transaction, so a successful registration always has its confirmation queued. */
export async function registerAsGuestForSeminar(seminarIdValue: unknown, firstNameValue: unknown, lastNameValue: unknown, emailValue: unknown, phoneValue: unknown, paymentMethodValue: unknown): Promise<{ paymentMethod: string; registrationId: number }> {
  const seminarId = idSchema.safeParse(seminarIdValue);
  if (!seminarId.success) throw new SeminarRegistrationError('Seminar not found.');
  const firstNameResult = guestFirstNameSchema.safeParse(firstNameValue);
  if (!firstNameResult.success) throw new SeminarRegistrationError('Enter your first name.');
  const lastNameResult = guestLastNameSchema.safeParse(lastNameValue);
  if (!lastNameResult.success) throw new SeminarRegistrationError('Enter your last name.');
  const emailResult = guestEmailSchema.safeParse(emailValue);
  if (!emailResult.success) throw new SeminarRegistrationError('Enter a valid email address.');
  const phoneResult = guestPhoneSchema.safeParse(phoneValue);
  if (!phoneResult.success) throw new SeminarRegistrationError('Enter a valid phone number.');
  const firstName = firstNameResult.data;
  const lastName = lastNameResult.data;
  const name = `${firstName} ${lastName}`;
  const email = emailResult.data.toLowerCase();
  const enabledMethods = await listEnabledSeminarPaymentMethods();
  const paymentMethod = validatePaymentMethod(enabledMethods, paymentMethodValue);
  const directDelivery = isStagingSeminarDirectDelivery();
  const { registrationId } = await client.begin(async (sql) => {
    const seminar = await requireSeminarOpenForRegistration(sql, seminarId.data);
    const [existing] = await sql<{ id: number; payment_status: string; registration_status: string }[]>`select id,registration_status,payment_status from seminar_registrations
      where seminar_id=${seminarId.data} and profile_id is null and lower(guest_email)=${email} for update`;
    if (existing?.registration_status === 'registered') throw new SeminarRegistrationError('This email is already registered for this seminar.');
    if (existing && !['unpaid', 'bank_transfer_pending', 'cash_pending'].includes(existing.payment_status)) {
      throw new SeminarRegistrationError('This registration has payment history and cannot be reactivated. Contact an administrator.');
    }
    const [details] = await sql<SeminarEmailDetails[]>`select title,start_date,end_date,location,language,organizing_national_federation,capacity,course_directors,participant_profile,course_venue_information,application,accommodation_information,registration_deadline,is_fei,levels,member_price_cents,non_member_price_cents from seminars where id=${seminarId.data} limit 1`;
    const paymentStatus = initialPaymentStatusForMethod(paymentMethod);
    let registrationId: number;
    if (existing) {
      await sql`update seminar_registrations set registration_status='registered',payment_status=${paymentStatus},
        payment_method_canonical_id=${paymentMethod},expected_amount_cents=${seminar.non_member_price_cents},currency='EUR',guest_name=${name},
        guest_first_name=${firstName},guest_last_name=${lastName},guest_phone=${phoneResult.data},guest_email=${email},
        stripe_checkout_session_id=null,checkout_status=null,checkout_created_at=null,
        stripe_payment_intent_id=null,paid_at=null,marked_paid_by_user_id=null,payment_status_updated_at=now(),
        registered_at=now(),canceled_at=null,updated_at=now() where id=${existing.id}`;
      registrationId = existing.id;
    } else {
      const [row] = await sql<{ id: number }[]>`insert into seminar_registrations (seminar_id,guest_name,guest_first_name,guest_last_name,guest_email,guest_phone,payment_status,payment_method_canonical_id,expected_amount_cents,currency)
        values (${seminarId.data},${name},${firstName},${lastName},${email},${phoneResult.data},${paymentStatus},${paymentMethod},${seminar.non_member_price_cents},'EUR') returning id`;
      registrationId = row.id;
    }
    await sql`insert into audit_log(actor_id,action,entity_type,entity_id,after_json) values
      (null,'guest.seminar_registration.registered','seminar_registration',${String(registrationId)},${JSON.stringify({ guestEmail: email, seminarId: seminarId.data })}::jsonb)`;
    const confirmationKind = directDelivery ? 'seminar.staging_registration_created' : 'seminar.registration_created';
    await sql`insert into notification_outbox(dead_lettered_at,last_error_code,profile_id,kind,payload,dedupe_key) values
      (${communicationHoldTimestamp()}::timestamptz,case when ${memberCommunicationsDisabled()} then 'member_launch_hold' else null end,null,${confirmationKind},${JSON.stringify({ amountCents: seminar.non_member_price_cents, firstName, paymentMethod, registrationId: 0, seminarId: seminarId.data, to: email })}::jsonb || jsonb_build_object('registrationId',${registrationId}::int),${`seminar.registration_created:guest:${registrationId}`})
      on conflict (dedupe_key) do nothing`;
    return { registrationId };
  });
  return { paymentMethod, registrationId };
}

export type SeminarEmailDetails = {
  accommodation_information: string; application: string; capacity: number; course_directors: string; course_venue_information: string;
  end_date: string; is_fei: boolean; language: string; levels: string[]; location: string; member_price_cents: number;
  non_member_price_cents: number; organizing_national_federation: string; participant_profile: string; registration_deadline: string | Date;
  start_date: string; title: string;
};

const EMAIL_ICON_BASE = 'https://res.cloudinary.com/z6xv27qx/image/upload/e_colorize,co_rgb:d3af37,w_20,h_20,c_fit/idoc-email-icons';

const SEMINAR_EMAIL_ICONS = {
  banknote: `${EMAIL_ICON_BASE}/banknote.png`,
  calendar: `${EMAIL_ICON_BASE}/calendar.png`,
  deadline: `${EMAIL_ICON_BASE}/calendar-clock.png`,
  flag: `${EMAIL_ICON_BASE}/flag.png`,
  language: `${EMAIL_ICON_BASE}/languages.png`,
  layers: `${EMAIL_ICON_BASE}/layers.png`,
  location: `${EMAIL_ICON_BASE}/map-pin.png`,
  users: `${EMAIL_ICON_BASE}/users.png`,
};

function seminarEmailInfoRow(iconUrl: string, value: string) {
  return `<tr>
    <td width="52" style="width:52px;padding:20px 8px 20px 20px;border-bottom:1px solid #343d55;vertical-align:middle;">
      <img alt="" src="${iconUrl}" width="20" height="20" style="display:block;width:20px;height:20px;border:0;" />
    </td>
    <td class="idoc-email-text" style="padding:20px 20px 20px 4px;border-bottom:1px solid #343d55;color:#eff2f7 !important;font-size:16px;line-height:1.5;vertical-align:middle;">${value}</td>
  </tr>`;
}

function richSeminarEmailSection(label: string, html: string) {
  if (!html.trim()) return '';
  return `<div style="margin:0 0 28px;"><div class="idoc-email-gold" style="margin-bottom:10px;color:#d3af37 !important;font-size:17px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(label)}</div><div class="idoc-email-text" style="color:#eff2f7 !important;font-size:15px;line-height:1.7;">${html}</div></div>`;
}

export async function getSeminarEmailDetails(seminarId: number): Promise<SeminarEmailDetails | null> {
  const [details] = await client<SeminarEmailDetails[]>`select title,start_date,end_date,location,language,organizing_national_federation,capacity,course_directors,participant_profile,course_venue_information,application,accommodation_information,registration_deadline,is_fei,levels,member_price_cents,non_member_price_cents from seminars where id=${seminarId} limit 1`;
  return details ?? null;
}

export async function seminarRegistrationConfirmationBodyHtml({ amountCents, firstName, paymentConfirmed = false, paymentMethod, seminar }: { amountCents?: number; firstName: string; paymentConfirmed?: boolean; paymentMethod: string; seminar: SeminarEmailDetails }) {
  const dateRange = dateOnly(seminar.start_date) === dateOnly(seminar.end_date) ? formatDate(dateOnly(seminar.start_date)) : `${formatDate(dateOnly(seminar.start_date))} – ${formatDate(dateOnly(seminar.end_date))}`;
  const levels = seminar.levels?.length ? formatLevels(seminar.levels) : '';
  const memberPrice = `€${(seminar.member_price_cents / 100).toFixed(2)}`;
  const nonMemberPrice = `€${(seminar.non_member_price_cents / 100).toFixed(2)}`;
  let paymentMessage = '';
  if (paymentMethod === 'bank_transfer') {
    const instructions = await getSeminarPaymentMethodInstructions('bank_transfer');
    paymentMessage = `<div style="margin:14px 0 0;"><strong class="idoc-email-gold" style="color:#d3af37 !important;">Bank transfer information:</strong><div class="idoc-email-text" style="margin-top:6px;color:#eff2f7 !important;">${instructions || '<p>Please contact IDOC for bank transfer instructions.</p>'}</div></div>`;
  } else if (paymentMethod === 'cash_event') {
    paymentMessage = '<p class="idoc-email-text" style="margin:12px 0 0;color:#eff2f7 !important;"><strong>Please remember to bring your cash payment to the event.</strong></p>';
  } else if (paymentMethod === 'online_stripe' && paymentConfirmed) {
    paymentMessage = '<p class="idoc-email-text" style="margin:12px 0 0;color:#eff2f7 !important;"><strong>Thank you for your Stripe payment.</strong> Your payment has been received.</p>';
  }

  const detailsCard = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0b152c" class="idoc-email-card" style="width:100%;margin:0 0 24px;border-collapse:separate;border-spacing:0;background:#0b152c !important;border:1px solid #343d55;border-radius:8px;overflow:hidden;">
    ${seminarEmailInfoRow(SEMINAR_EMAIL_ICONS.calendar, escapeHtml(dateRange))}
    ${seminarEmailInfoRow(SEMINAR_EMAIL_ICONS.location, escapeHtml(seminar.location))}
    ${seminarEmailInfoRow(SEMINAR_EMAIL_ICONS.language, `Language: ${escapeHtml(languageNameForTag(seminar.language))}`)}
    ${seminarEmailInfoRow(SEMINAR_EMAIL_ICONS.flag, `Organizing National Federation: ${escapeHtml(countryNameForCode(seminar.organizing_national_federation))}`)}
    ${seminarEmailInfoRow(SEMINAR_EMAIL_ICONS.users, `Number of participants: ${escapeHtml(String(seminar.capacity))}`)}
    ${seminarEmailInfoRow(SEMINAR_EMAIL_ICONS.banknote, `Members: ${escapeHtml(memberPrice)} · Non-members: ${escapeHtml(nonMemberPrice)}`)}
    ${levels ? seminarEmailInfoRow(SEMINAR_EMAIL_ICONS.layers, escapeHtml(levels)) : ''}
    ${seminarEmailInfoRow(SEMINAR_EMAIL_ICONS.deadline, `Registration deadline: ${escapeHtml(formatDate(dateOnly(seminar.registration_deadline)))}`)}
    ${seminar.is_fei ? '<tr><td colspan="2" style="padding:20px;border-top:1px solid #343d55;"><strong class="idoc-email-text" style="color:#eff2f7 !important;font-size:13px;letter-spacing:.08em;">FEI SEMINAR</strong></td></tr>' : ''}
  </table>`;

  const informationCard = `<div class="idoc-email-card" style="margin:0;background:#0b152c !important;border:1px solid #343d55;border-radius:8px;padding:24px 22px;">
    ${richSeminarEmailSection('Course Directors', seminar.course_directors)}
    ${richSeminarEmailSection('Participant Profile', seminar.participant_profile)}
    ${richSeminarEmailSection('Course Venue Information', seminar.course_venue_information)}
    ${richSeminarEmailSection('Application', seminar.application)}
    ${richSeminarEmailSection('Accommodation Information', seminar.accommodation_information)}
  </div>`;

  return `<div style="margin-bottom:30px;"><p style="margin-top:0;">Hello ${escapeHtml(firstName)},</p><p>Thank you for registering for <strong>${escapeHtml(seminar.title)}</strong>.</p>${paymentMessage}</div>${detailsCard}${informationCard}`;
}

export async function cancelOwnRegistration(seminarIdValue: unknown): Promise<void> {
  const { profileId } = await requireOwnProfileIdRegardlessOfEntitlement();
  const seminarId = idSchema.safeParse(seminarIdValue);
  if (!seminarId.success) throw new SeminarRegistrationError('Seminar not found.');
  await client.begin(async (sql) => {
    const [existing] = await sql<{ id: number; registration_status: string }[]>`select id,registration_status from seminar_registrations
      where seminar_id=${seminarId.data} and profile_id=${profileId} for update`;
    if (!existing || existing.registration_status === 'canceled') throw new SeminarRegistrationError('No active registration was found.');
    await sql`update seminar_registrations set registration_status='canceled',canceled_at=now(),updated_at=now() where id=${existing.id}`;
    await sql`insert into audit_log(actor_id,action,entity_type,entity_id) values
      (null,'member.seminar_registration.canceled','seminar_registration',${String(existing.id)})`;
    await sql`insert into notification_outbox(dead_lettered_at,last_error_code,profile_id,kind,payload,dedupe_key) values
      (${communicationHoldTimestamp()}::timestamptz,case when ${memberCommunicationsDisabled()} then 'member_launch_hold' else null end,${profileId},'seminar.registration_canceled',(select jsonb_build_object('registrationId',${existing.id}::int,'seminarId',${seminarId.data}::int,'to',u.email::text,'firstName',p.first_name::text)
        from profiles p join users u on u.id=p.user_id where p.id=${profileId}),${`seminar.registration_canceled:${existing.id}:${Date.now()}`})`;
  });
}

type ManualPaymentStripeClient = { checkout: { sessions: { retrieve?: (id: string) => Promise<{ status?: string | null }> } } };

/** Manually confirms a bank-transfer/cash payment (Stripe payments are marked paid automatically by
 * the webhook and never go through here) -- records which method was actually used (it may differ
 * from what the registrant originally selected) and an optional reference note, mirroring the
 * evidence trail lib/payments/manual-payments.ts keeps for membership payments. */
export async function recordManualSeminarPayment(registrationIdValue: unknown, methodValue: unknown, referenceValue: unknown, testStripeClient?: ManualPaymentStripeClient): Promise<void> {
  if (testStripeClient && process.env.NODE_ENV !== 'test') throw new Error('Stripe client overrides are test-only.');
  const actor = await requireSeminarAdministrator();
  const registrationId = idSchema.safeParse(registrationIdValue);
  if (!registrationId.success) throw new SeminarRegistrationError('Registration not found.');
  const method = typeof methodValue === 'string' ? methodValue.trim() : '';
  if (!(MANUAL_PAYMENT_METHODS as readonly string[]).includes(method)) throw new SeminarRegistrationError('Choose Bank Transfer or Cash.');
  const reference = typeof referenceValue === 'string' && referenceValue.trim() ? referenceValue.trim().slice(0, 1000) : null;
  await client.begin(async (sql) => {
    const [existing] = await sql<{ checkout_status: string | null; payment_status: PaymentStatus; stripe_checkout_session_id: string | null }[]>`select payment_status,checkout_status,stripe_checkout_session_id from seminar_registrations where id=${registrationId.data} for update`;
    if (!existing) throw new SeminarRegistrationError('Registration not found.');
    if (existing.payment_status === 'paid') return;
    // A registrant with an open Stripe Checkout Session can still complete it after an administrator
    // records a manual payment here -- the webhook then skips its own update because the local status
    // is already 'paid', silently double-charging with no local record of the Stripe payment to
    // refund. The local checkout_status only ever updates when createSeminarCheckoutSession is
    // revisited, so an abandoned session (never expired against, since the registrant never came back)
    // would otherwise stay 'open' forever and permanently block a legitimate manual payment -- refresh
    // it against Stripe itself here rather than trusting the possibly-stale local column.
    let checkoutStatus = existing.checkout_status;
    if (checkoutStatus === 'open' && existing.stripe_checkout_session_id) {
      // Resolved lazily, and only when a locally-open session actually needs checking, so a cash/bank-
      // transfer registration (which never had a Stripe session) never requires Stripe configuration.
      const stripe = testStripeClient ?? (getStripeServerClient() as ManualPaymentStripeClient);
      if (stripe.checkout.sessions.retrieve) {
        const session = await stripe.checkout.sessions.retrieve(existing.stripe_checkout_session_id);
        checkoutStatus = session.status === 'open' ? 'open' : session.status === 'expired' ? 'expired' : 'superseded';
        if (checkoutStatus !== 'open') {
          await sql`update seminar_registrations set checkout_status=${checkoutStatus},updated_at=now() where id=${registrationId.data}`;
        }
      }
    }
    if (checkoutStatus === 'open') throw new SeminarRegistrationError('This registration has an open Stripe checkout session. Wait for it to expire, or ask the registrant to complete or abandon it, before recording a manual payment.');
    await sql`update seminar_registrations set payment_status='paid',payment_method_canonical_id=${method},payment_reference=${reference},
      paid_at=now(),marked_paid_by_user_id=${actor.id},payment_status_updated_at=now(),updated_at=now() where id=${registrationId.data}`;
    await sql`insert into audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
      (${actor.id},'admin.seminar_registration.payment_marked_paid','seminar_registration',${String(registrationId.data)},
      ${JSON.stringify({ paymentStatus: existing.payment_status })}::jsonb,${JSON.stringify({ method, reference })}::jsonb)`;
  });
}

/** Directly changes a registration's own status (e.g. an administrator canceling one person's
 * registration without canceling the whole seminar) -- distinct from the cascade in
 * lib/seminars/seminars.ts's updateSeminar, which cancels every registration at once. */
export async function setAdminRegistrationStatus(registrationIdValue: unknown, statusValue: unknown): Promise<void> {
  const actor = await requireSeminarAdministrator();
  const registrationId = idSchema.safeParse(registrationIdValue);
  if (!registrationId.success) throw new SeminarRegistrationError('Registration not found.');
  const status = typeof statusValue === 'string' ? statusValue.trim() : '';
  if (!(REGISTRATION_STATUSES as readonly string[]).includes(status)) throw new SeminarRegistrationError('Choose a valid registration status.');
  await client.begin(async (sql) => {
    // An unlocked peek first, so a reactivation's seminar lock (below) can be acquired before this
    // registration's own lock -- the same order registerForSeminar/registerAsGuestForSeminar already
    // use. Taking them in the opposite order (registration first, seminar second, as an earlier
    // version of this function did) would deadlock against a concurrent registration attempt on the
    // same seminar. The actual correctness gate is still the locked re-read just below, so staleness
    // here has no effect beyond possibly taking (and safely releasing) an unnecessary seminar lock.
    const [peek] = await sql<{ registration_status: string; seminar_id: number }[]>`select registration_status,seminar_id from seminar_registrations where id=${registrationId.data}`;
    if (!peek) throw new SeminarRegistrationError('Registration not found.');
    // Reactivating a canceled registration must clear the same seminar-status/deadline/capacity gate a
    // brand-new registration goes through -- otherwise an administrator could reactivate one after the
    // seminar was itself canceled (the cascade in updateSeminar) or after other registrations already
    // filled its capacity, producing an active registration for a canceled or over-capacity seminar.
    if (peek.registration_status === 'canceled' && status === 'registered') {
      await requireSeminarOpenForRegistration(sql, peek.seminar_id);
    }
    const [existing] = await sql<{ registration_status: string }[]>`select registration_status from seminar_registrations where id=${registrationId.data} for update`;
    if (!existing) throw new SeminarRegistrationError('Registration not found.');
    if (existing.registration_status === status) return;
    if (status === 'canceled') {
      await sql`update seminar_registrations set registration_status='canceled',canceled_at=now(),updated_at=now() where id=${registrationId.data}`;
    } else {
      await sql`update seminar_registrations set registration_status=${status},canceled_at=null,updated_at=now() where id=${registrationId.data}`;
    }
    await sql`insert into audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
      (${actor.id},'admin.seminar_registration.status_changed','seminar_registration',${String(registrationId.data)},
      ${JSON.stringify({ registrationStatus: existing.registration_status })}::jsonb,${JSON.stringify({ registrationStatus: status })}::jsonb)`;
  });
}

function isGuestEmailRaceViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505'
    && (error as { constraint_name?: unknown }).constraint_name === 'seminar_registrations_seminar_guest_email_unique';
}

/** Lets an administrator edit a guest registration's own contact details and either registrant's
 * chosen payment method -- the identity split (member vs. guest) itself is never editable here,
 * since a registration's profileId/guestName+email pairing is fixed at creation (docs/02 §12). */
export async function updateSeminarRegistrationDetails(registrationIdValue: unknown, fields: { guestEmail?: unknown; guestFirstName?: unknown; guestLastName?: unknown; guestPhone?: unknown; paymentMethod?: unknown }): Promise<void> {
  const actor = await requireSeminarAdministrator();
  const registrationId = idSchema.safeParse(registrationIdValue);
  if (!registrationId.success) throw new SeminarRegistrationError('Registration not found.');
  const requestedMethod = typeof fields.paymentMethod === 'string' ? fields.paymentMethod.trim() : '';
  //CHECK ENABLED METHODS BEFORE OPENING THE ROW-LOCKING TRANSACTION SO WE DO
  //NOT RESERVE ANOTHER CONNECTION THROUGH THE GLOBAL DATABASE CLIENT.
  const enabledMethods = await listEnabledSeminarPaymentMethods();
  try {
    await client.begin(async (sql) => {
      const [existing] = await sql<{ guest_email: string | null; guest_first_name: string | null; guest_last_name: string | null; guest_name: string | null; guest_phone: string | null; payment_method_canonical_id: string; profile_id: number | null }[]>`select guest_email,guest_first_name,guest_last_name,guest_name,guest_phone,payment_method_canonical_id,profile_id
        from seminar_registrations where id=${registrationId.data} for update`;
      if (!existing) throw new SeminarRegistrationError('Registration not found.');
      // Leaving the payment method exactly as it already was is always allowed, even if an
      // administrator has since disabled that method in Organization Settings -- only switching to
      // a genuinely different method requires it to be currently enabled.
      const paymentMethod = requestedMethod === existing.payment_method_canonical_id
        ? requestedMethod : validatePaymentMethod(enabledMethods, requestedMethod);
      if (existing.profile_id === null) {
        const rawFirstName = typeof fields.guestFirstName === 'string' ? fields.guestFirstName.trim() : '';
        const rawLastName = typeof fields.guestLastName === 'string' ? fields.guestLastName.trim() : '';
        const rawPhone = typeof fields.guestPhone === 'string' ? fields.guestPhone.trim() : '';
        const firstNameResult = rawFirstName ? guestFirstNameSchema.safeParse(rawFirstName) : null;
        const lastNameResult = rawLastName ? guestLastNameSchema.safeParse(rawLastName) : null;
        const phoneResult = rawPhone ? guestPhoneSchema.safeParse(rawPhone) : null;
        if (firstNameResult && !firstNameResult.success) throw new SeminarRegistrationError("Enter a valid guest first name.");
        if (lastNameResult && !lastNameResult.success) throw new SeminarRegistrationError("Enter a valid guest last name.");
        if (phoneResult && !phoneResult.success) throw new SeminarRegistrationError('Enter a valid guest phone number.');
        const emailResult = guestEmailSchema.safeParse(fields.guestEmail);
        if (!emailResult.success) throw new SeminarRegistrationError('Enter a valid guest email address.');
        const firstName = firstNameResult?.success ? firstNameResult.data : existing.guest_first_name;
        const lastName = lastNameResult?.success ? lastNameResult.data : existing.guest_last_name;
        const phone = phoneResult?.success ? phoneResult.data : existing.guest_phone;
        const structuredName = [firstName, lastName].filter(Boolean).join(' ');
        await sql`update seminar_registrations set guest_name=${structuredName || existing.guest_name},guest_first_name=${firstName},guest_last_name=${lastName},guest_phone=${phone},guest_email=${emailResult.data.toLowerCase()},
          payment_method_canonical_id=${paymentMethod},updated_at=now() where id=${registrationId.data}`;
      } else {
        await sql`update seminar_registrations set payment_method_canonical_id=${paymentMethod},updated_at=now() where id=${registrationId.data}`;
      }
      await sql`insert into audit_log(actor_id,action,entity_type,entity_id,before_json,after_json) values
        (${actor.id},'admin.seminar_registration.details_updated','seminar_registration',${String(registrationId.data)},
        ${JSON.stringify({ guestEmail: existing.guest_email, guestName: existing.guest_name, paymentMethod: existing.payment_method_canonical_id })}::jsonb,
        ${JSON.stringify({ paymentMethod })}::jsonb)`;
    });
  } catch (error) {
    if (isGuestEmailRaceViolation(error)) throw new SeminarRegistrationError('Another registration for this seminar already uses that email.');
    throw error;
  }
}

/** The seminar edit page's own registration counts -- distinct from listAdminAllSeminarRegistrations,
 * which is paginated and would need every page fetched to total correctly. */
export async function getSeminarRegistrationCounts(seminarIdValue: unknown): Promise<{ active: number; total: number }> {
  await requireSeminarAdministrator();
  const seminarId = idSchema.safeParse(seminarIdValue);
  if (!seminarId.success) return { active: 0, total: 0 };
  const [row] = await client<{ active: number; total: number }[]>`select count(*) filter(where registration_status='registered')::int active,count(*)::int total
    from seminar_registrations where seminar_id=${seminarId.data}`;
  return row ?? { active: 0, total: 0 };
}

/** Seminars an administrator can filter the registrations roster by -- published only, per the
 * Registrations page's own filter contract (a draft/canceled seminar isn't a meaningful facet
 * option there even though its historical registrations still show up unfiltered). */
export async function listPublishedSeminarsForRegistrationFilter() {
  await requireSeminarAdministrator();
  return client<{ id: number; title: string }[]>`select id,title from seminars where status='published' order by start_date desc`;
}

function registrationsWhere(input: Record<string, string | string[] | undefined>) {
  const firstValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const seminarIds = many(input.seminarId).map(Number).filter((value) => Number.isInteger(value) && value > 0);
  const paymentStatuses = many(input.paymentStatus).filter((value) => (PAYMENT_STATUSES as readonly string[]).includes(value));
  const registrantTypes = many(input.registrantType).filter((value) => value === 'member' || value === 'guest');
  const search = (firstValue(input.q) ?? '').trim().slice(0, 100);
  const fromValue = firstValue(input.from) ?? '';
  const toValue = firstValue(input.to) ?? '';
  const from = listDate(fromValue);
  const to = listDate(toValue);
  return { from, paymentStatuses, registrantTypes, search, seminarIds, to };
}

/** The cross-seminar registrations roster (Admin Dashboard > Registrations): every registration,
 * member or guest, searchable by registrant name/email and filterable by seminar, payment status,
 * and registration date range -- the seminar-scoped table this superseded only ever showed one
 * seminar's rows at a time. */
export async function listAdminAllSeminarRegistrations(input: Record<string, string | string[] | undefined>) {
  await requireSeminarAdministrator();
  const page = listPage(input);
  const limit = listPageSize(input);
  const offset = (page - 1) * limit;
  const { from, paymentStatuses, registrantTypes, search, seminarIds, to } = registrationsWhere(input);
  const order = listOrder(input, {
    registered: 'r.registered_at', registrant: 'registrant_name', seminar: 's.title', status: 'r.payment_status',
  }, 'registered', 'r.id');
  const seminarWhere = seminarIds.length ? client`r.seminar_id in ${client(seminarIds)}` : client`true`;
  const paymentStatusWhere = paymentStatuses.length ? client`r.payment_status in ${client(paymentStatuses)}` : client`true`;
  const advancedWhere = advancedListWhere(input, { status: 'r.payment_status' }, PAYMENT_STATUSES);
  const registrantTypeWhere = registrantTypes.length === 0 || registrantTypes.length === 2 ? client`true`
    : registrantTypes[0] === 'guest' ? client`r.profile_id is null` : client`r.profile_id is not null`;
  const rows = await client`select r.id,r.registration_status,r.payment_status,r.payment_method_canonical_id,r.expected_amount_cents,r.currency,
    r.registered_at,r.canceled_at,r.paid_at,s.id seminar_id,s.title seminar_title,
    coalesce(p.first_name||' '||p.last_name,r.guest_name) registrant_name,coalesce(u.email_display,u.email,r.guest_email) registrant_email,
    (r.profile_id is null) is_guest,count(*) over()::int total_count
    from seminar_registrations r join seminars s on s.id=r.seminar_id
    left join profiles p on p.id=r.profile_id left join users u on u.id=p.user_id
    where (${seminarWhere}) and (${paymentStatusWhere}) and (${registrantTypeWhere})
    and (${from}::date is null or r.registered_at>=${from}::date) and (${to}::date is null or r.registered_at<${to}::date + 1)
    and (${search}='' or coalesce(p.first_name||' '||p.last_name,r.guest_name,'') ilike ${`%${search}%`} or coalesce(u.email,r.guest_email,'') ilike ${`%${search}%`})
    and (${advancedWhere})
    order by ${order} limit ${limit + 1} offset ${offset}`;
  return { hasNext: rows.length > limit, page, pageSize: limit, rows: rows.slice(0, limit), total: Number(rows[0]?.total_count ?? 0) };
}

export async function exportAllSeminarRegistrationsCsvRows(input: Record<string, string | string[] | undefined>) {
  const actor = await requireSeminarAdministrator();
  const { from, paymentStatuses, registrantTypes, search, seminarIds, to } = registrationsWhere(input);
  const seminarWhere = seminarIds.length ? client`r.seminar_id in ${client(seminarIds)}` : client`true`;
  const paymentStatusWhere = paymentStatuses.length ? client`r.payment_status in ${client(paymentStatuses)}` : client`true`;
  const advancedWhere = advancedListWhere(input, { status: 'r.payment_status' }, PAYMENT_STATUSES);
  const registrantTypeWhere = registrantTypes.length === 0 || registrantTypes.length === 2 ? client`true`
    : registrantTypes[0] === 'guest' ? client`r.profile_id is null` : client`r.profile_id is not null`;
  const rows = await client`select s.title seminar_title,coalesce(p.first_name||' '||p.last_name,r.guest_name) registrant_name,
    coalesce(u.email_display,u.email,r.guest_email) registrant_email,(r.profile_id is null) is_guest,
    r.registration_status,r.payment_status,r.payment_method_canonical_id,r.expected_amount_cents,r.currency,
    r.registered_at,r.canceled_at,r.paid_at,
    (select string_agg(pr.external_refund_id, ';' order by pr.requested_at) from payment_refunds pr where pr.seminar_registration_id=r.id) refund_ids,
    (select coalesce(sum(pr.amount_cents) filter(where pr.status='succeeded'),0)::int from payment_refunds pr where pr.seminar_registration_id=r.id) refunded_amount_cents
    from seminar_registrations r join seminars s on s.id=r.seminar_id
    left join profiles p on p.id=r.profile_id left join users u on u.id=p.user_id
    where (${seminarWhere}) and (${paymentStatusWhere}) and (${registrantTypeWhere})
    and (${from}::date is null or r.registered_at>=${from}::date) and (${to}::date is null or r.registered_at<${to}::date + 1)
    and (${search}='' or coalesce(p.first_name||' '||p.last_name,r.guest_name,'') ilike ${`%${search}%`} or coalesce(u.email,r.guest_email,'') ilike ${`%${search}%`})
    and (${advancedWhere})
    order by r.registered_at limit ${REGISTRATION_EXPORT_LIMIT + 1}`;
  if (rows.length > REGISTRATION_EXPORT_LIMIT) throw new SeminarRegistrationError(`Export exceeds the safe limit of ${REGISTRATION_EXPORT_LIMIT} registrations. Narrow the filters and retry.`);
  await client`insert into audit_log(actor_id,action,entity_type,entity_id,after_json) values
    (${actor.id},'admin.seminar_registrations.exported','seminar_registration',${'all'},${JSON.stringify({ resultCount: rows.length })}::jsonb)`;
  return rows;
}

export type AdminSeminarRegistrationRow = {
  canceled_at: Date | string | null; currency: string; expected_amount_cents: number | null; guest_email: string | null; guest_name: string | null;
  guest_first_name: string | null; guest_last_name: string | null; guest_phone: string | null;
  id: number; member_email: string | null; member_name: string | null; paid_at: Date | string | null; payment_method_canonical_id: string;
  payment_reference: string | null; payment_status: PaymentStatus; profile_id: number | null; registered_at: Date | string;
  registration_status: 'canceled' | 'registered'; seminar_id: number; seminar_title: string;
};
export async function getAdminSeminarRegistration(registrationIdValue: unknown): Promise<AdminSeminarRegistrationRow | null> {
  await requireSeminarAdministrator();
  const registrationId = idSchema.safeParse(registrationIdValue);
  if (!registrationId.success) return null;
  const [row] = await client<AdminSeminarRegistrationRow[]>`select r.id,r.seminar_id,s.title seminar_title,r.profile_id,
    coalesce(p.first_name||' '||p.last_name,'') member_name,coalesce(u.email_display,u.email) member_email,r.guest_name,r.guest_first_name,r.guest_last_name,r.guest_email,r.guest_phone,
    r.registration_status,r.payment_status,r.payment_method_canonical_id,r.payment_reference,r.expected_amount_cents,r.currency,
    r.registered_at,r.canceled_at,r.paid_at
    from seminar_registrations r join seminars s on s.id=r.seminar_id
    left join profiles p on p.id=r.profile_id left join users u on u.id=p.user_id
    where r.id=${registrationId.data} limit 1`;
  return row ?? null;
}

export async function exportSeminarRegistrationsCsvRows(seminarIdValue: unknown) {
  const actor = await requireSeminarAdministrator();
  const seminarId = idSchema.safeParse(seminarIdValue);
  if (!seminarId.success) throw new SeminarRegistrationError('Seminar not found.');
  const rows = await client`select s.title seminar_title,coalesce(p.first_name||' '||p.last_name,r.guest_name) registrant_name,
    coalesce(u.email_display,u.email,r.guest_email) registrant_email,(r.profile_id is null) is_guest,
    r.registration_status,r.payment_status,r.payment_method_canonical_id,r.expected_amount_cents,r.currency,
    r.registered_at,r.canceled_at,r.paid_at,
    (select string_agg(pr.external_refund_id, ';' order by pr.requested_at) from payment_refunds pr where pr.seminar_registration_id=r.id) refund_ids,
    (select coalesce(sum(pr.amount_cents) filter(where pr.status='succeeded'),0)::int from payment_refunds pr where pr.seminar_registration_id=r.id) refunded_amount_cents
    from seminar_registrations r join seminars s on s.id=r.seminar_id
    left join profiles p on p.id=r.profile_id left join users u on u.id=p.user_id
    where r.seminar_id=${seminarId.data} order by r.registered_at limit ${REGISTRATION_EXPORT_LIMIT + 1}`;
  if (rows.length > REGISTRATION_EXPORT_LIMIT) throw new SeminarRegistrationError(`Export exceeds the safe limit of ${REGISTRATION_EXPORT_LIMIT} registrations. Narrow the filters and retry.`);
  await client`insert into audit_log(actor_id,action,entity_type,entity_id,after_json) values
    (${actor.id},'admin.seminar_registrations.exported','seminar',${String(seminarId.data)},${JSON.stringify({ resultCount: rows.length })}::jsonb)`;
  return rows;
}
