import 'server-only';
import { communicationHoldFields, logMemberLaunchHold, memberCommunicationsDisabled, outboxDeliveryHeld } from '@/lib/runtime/member-launch-hold';

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { notificationOutbox, profiles, seminarRegistrations, users } from '@/lib/db/schema';
import { getSeminarEmailDetails, seminarRegistrationConfirmationBodyHtml } from '@/lib/seminars/registrations';
import { OPEN_SUBSCRIPTION_STATUSES } from '@/lib/payments/pricing';
import { AUTO_RENEWAL_NOTICE_DAYS, GRACE_REMINDER_DAYS_BEFORE_END, NON_RENEWAL_EXPIRATION_NOTICE_DAYS } from '@/lib/payments/renewal';
import { sendTransactionalEmail } from './brevo-transactional';
import { emailButton, emailInfoCard, emailInfoRow, emailNoticeCard, escapeHtml, IDOC_EMAIL_ICONS, renderTransactionalEmail } from './email-template';
import { processDeliveryBatch } from './account-delivery-worker-core';
import { formatDate } from '@/lib/format';

export const RENEWAL_NOTICE_BATCH_LIMIT = 20;
const GRACE_EXPIRY_BATCH_LIMIT = 500;
const MAX_ATTEMPTS = 6;
export const STAGING_SEMINAR_CONFIRMATION_KIND = 'seminar.staging_registration_created';

const RENEWAL_NOTICE_KINDS = [
  'membership.renewal_reminder',
  'membership.expiration_reminder',
  'membership.payment_failed',
  'membership.grace_reminder',
  'membership.grace_expired',
  'seminar.registration_created',
  'seminar.registration_canceled',
  'seminar.payment_confirmed',
  'seminar.refund_confirmed',
] as const;

export type NoticePayload = {
  expirationDate?: string;
  firstName?: string | null;
  graceEndDate?: string;
  renewalDate?: string;
  amountCents?: number;
  paymentMethod?: string;
  paymentConfirmed?: boolean;
  seminarId?: number;
  registrationId?: number;
  to?: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// One INSERT ... SELECT ... ON CONFLICT DO NOTHING per reminder type keeps each scan atomic and
// avoids an N+1 loop over candidate profiles; the unique dedupe_key makes re-running a missed or
// overlapping cron tick safe.
async function enqueueRenewalReminders(today: string): Promise<number> {
  const inserted = await db.execute(sql`
    insert into idoc.notification_outbox (profile_id, kind, payload, dedupe_key)
    select s.profile_id, 'membership.renewal_reminder',
      jsonb_build_object('to', u.email, 'firstName', p.first_name, 'renewalDate', s.current_period_end),
      'membership.renewal_reminder:' || s.profile_id || ':' || s.current_period_end
    from idoc.subscriptions s
    join idoc.profiles p on p.id = s.profile_id
    join idoc.users u on u.id = p.user_id
    where s.status = 'active' and s.cancel_at_period_end = false
      and s.current_period_end between ${today}::date and (${today}::date + ${AUTO_RENEWAL_NOTICE_DAYS}::int)
    union all
    select r.profile_id, 'membership.renewal_reminder',
      jsonb_build_object('to', u2.email, 'firstName', p2.first_name, 'renewalDate', r.effective_on),
      'membership.renewal_reminder:' || r.profile_id || ':' || r.effective_on
    from idoc.renewal_preferences r
    join idoc.profiles p2 on p2.id = r.profile_id
    join idoc.users u2 on u2.id = p2.user_id
    where r.pending_mode = 'recurring'
      and r.transition_state = 'pending_activation'
      and r.external_subscription_schedule_id is not null
      and r.effective_on between ${today}::date and (${today}::date + ${AUTO_RENEWAL_NOTICE_DAYS}::int)
    on conflict (dedupe_key) do nothing
    returning id
  `);
  return inserted.length;
}

async function enqueueExpirationReminders(today: string): Promise<number> {
  const openStatuses = sql.join(OPEN_SUBSCRIPTION_STATUSES.map((status) => sql`${status}`), sql`, `);
  const inserted = await db.execute(sql`
    insert into idoc.notification_outbox (profile_id, kind, payload, dedupe_key)
    select m.profile_id, 'membership.expiration_reminder',
      jsonb_build_object('to', u.email, 'firstName', p.first_name, 'expirationDate', m.valid_until),
      'membership.expiration_reminder:' || m.profile_id || ':' || m.valid_until
    from idoc.memberships m
    join idoc.profiles p on p.id = m.profile_id
    join idoc.users u on u.id = p.user_id
    where m.status in ('active', 'complimentary')
      and m.valid_until between ${today}::date and (${today}::date + ${NON_RENEWAL_EXPIRATION_NOTICE_DAYS}::int)
      and not exists (
        select 1 from idoc.subscriptions s2
        where s2.profile_id = m.profile_id and s2.status in (${openStatuses}) and s2.cancel_at_period_end = false
      )
    on conflict (dedupe_key) do nothing
    returning id
  `);
  return inserted.length;
}

async function enqueueGraceReminders(today: string): Promise<number> {
  const inserted = await db.execute(sql`
    insert into idoc.notification_outbox (profile_id, kind, payload, dedupe_key)
    select m.profile_id, 'membership.grace_reminder',
      jsonb_build_object('to', u.email, 'firstName', p.first_name, 'graceEndDate', coalesce(m.grace_ends_on,m.valid_until)),
      'membership.grace_reminder:' || m.profile_id || ':' || coalesce(m.grace_ends_on,m.valid_until)
    from idoc.memberships m
    join idoc.profiles p on p.id = m.profile_id
    join idoc.users u on u.id = p.user_id
    where m.status = 'grace'
      and (coalesce(m.grace_ends_on,m.valid_until) - ${GRACE_REMINDER_DAYS_BEFORE_END}::int) <= ${today}::date
      and coalesce(m.grace_ends_on,m.valid_until) > ${today}::date
    on conflict (dedupe_key) do nothing
    returning id
  `);
  return inserted.length;
}

// The one sub-scan that mutates entitlement state, so each row is claimed and transitioned in its
// own atomic statement rather than a bulk insert. `for update skip locked` means Postgres evaluates
// `where status='grace'` after acquiring the row lock: whichever transaction (this loop's or a
// concurrent handleInvoicePaid) commits first "wins" the row, and the other's predicate simply no
// longer matches — a correct compare-and-swap with no separate re-check step needed.
async function transitionExpiredGraceMemberships(today: string): Promise<number> {
  let count = 0;
  for (let iterations = 0; iterations < GRACE_EXPIRY_BATCH_LIMIT; iterations += 1) {
    const [expired] = await db.execute<{ id: number; profileId: number; validUntil: string }>(sql`
      with candidate as (
        select id from idoc.memberships
        where status = 'grace' and coalesce(grace_ends_on,valid_until) < ${today}::date
        order by id for update skip locked limit 1
      )
      update idoc.memberships m set status = 'expired', grace_ends_on = null, updated_at = now()
      from candidate where m.id = candidate.id
      returning m.id, m.profile_id as "profileId", m.valid_until as "validUntil"
    `);
    if (!expired) break;
    const [contact] = await db.select({ email: users.email, firstName: profiles.firstName })
      .from(profiles).innerJoin(users, eq(profiles.userId, users.id)).where(eq(profiles.id, expired.profileId)).limit(1);
    await db.insert(notificationOutbox).values({ ...communicationHoldFields(),
      dedupeKey: `membership.grace_expired:${expired.profileId}:${expired.validUntil}`,
      kind: 'membership.grace_expired',
      payload: { firstName: contact?.firstName, to: contact?.email },
      profileId: expired.profileId,
    }).onConflictDoNothing({ target: notificationOutbox.dedupeKey });
    count += 1;
  }
  return count;
}

/** Starts non-recurring grace from the day after the paid-through date, never from scan time. */
async function transitionNonRecurringTerms(today: string): Promise<number> {
  const changed = await db.execute(sql`
    update idoc.memberships m set
      status = case when m.valid_until + 5 < ${today}::date then 'expired' else 'grace' end,
      grace_ends_on = case when m.valid_until + 5 < ${today}::date then null else m.valid_until + 5 end,
      updated_at = now()
    where m.status in ('active', 'complimentary') and m.valid_until < ${today}::date
      and not exists (select 1 from idoc.subscriptions s where s.profile_id=m.profile_id
        and s.status in ('active','trialing','past_due','incomplete') and s.cancel_at_period_end=false)
    returning m.id
  `);
  return changed.length;
}

export async function enqueueRenewalNotices(today: string = todayIso()) {
  const nonRecurringGrace = await transitionNonRecurringTerms(today);
  if (memberCommunicationsDisabled()) {
    logMemberLaunchHold('job.renewal_scan');
    const graceExpired = await transitionExpiredGraceMemberships(today);
    return { blocked: 1, expirationReminders: 0, graceExpired, graceReminders: 0, nonRecurringGrace, renewalReminders: 0 };
  }
  const [renewalReminders, expirationReminders, graceReminders, graceExpired] = await Promise.all([
    enqueueRenewalReminders(today),
    enqueueExpirationReminders(today),
    enqueueGraceReminders(today),
    transitionExpiredGraceMemberships(today),
  ]);
  return { blocked: 0, expirationReminders, graceExpired, graceReminders, nonRecurringGrace, renewalReminders };
}

export async function renderNotice(kind: string, payload: NoticePayload): Promise<{ html: string; subject: string }> {
  if (kind === 'seminar.registration_created' || kind === STAGING_SEMINAR_CONFIRMATION_KIND) {
    // Registration confirmations retain their detailed seminar-specific design while sharing the
    // same outer IDOC brand shell used by every transactional email.
    let seminarId = payload.seminarId;
    if (!seminarId && payload.registrationId) {
      const [registration] = await db.select({ seminarId: seminarRegistrations.seminarId })
        .from(seminarRegistrations).where(eq(seminarRegistrations.id, payload.registrationId)).limit(1);
      seminarId = registration?.seminarId;
    }
    if (!seminarId) throw new Error('seminar_registration_confirmation_missing_seminar_id');
    if (!payload.paymentMethod) throw new Error('seminar_registration_confirmation_missing_payment_method');
    const seminar = await getSeminarEmailDetails(seminarId);
    if (!seminar) throw new Error('seminar_registration_confirmation_missing_seminar');
    return {
      html: renderTransactionalEmail({
        bodyHtml: await seminarRegistrationConfirmationBodyHtml({
          amountCents: payload.amountCents,
          firstName: payload.firstName ?? '',
          paymentConfirmed: payload.paymentConfirmed ?? false,
          paymentMethod: payload.paymentMethod,
          seminar,
        }),
        heading: `Thank you for registering for ${escapeHtml(seminar.title)}`,
      }),
      subject: 'Your IDOC seminar registration',
    };
  }

  const greeting = payload.firstName ? `Hello ${escapeHtml(payload.firstName)},` : 'Hello,';
  // Notification delivery must not depend on privileged runtime configuration just to render an
  // email. Production/staging use BASE_URL when present; isolated workers/tests retain a safe,
  // absolute public fallback rather than failing the delivery before the provider call.
  const membershipUrl = process.env.BASE_URL?.trim()
    ? new URL('/dashboard/membership', process.env.BASE_URL).toString()
    : 'https://idoc.club/dashboard/membership';
  const amount = `€${((payload.amountCents ?? 0) / 100).toFixed(2)}`;

  const membershipIntro = (message: string) =>
    `<p style="margin:0 0 18px;">${greeting}</p><p style="margin:0 0 18px;">${message}</p>`;

  const { bodyHtml, footerNote, heading, subject } = (() => {
    switch (kind) {
      case 'membership.renewal_reminder': {
        const renewalDate = formatDate(payload.renewalDate);
        return {
          bodyHtml:
            membershipIntro('This is a reminder that your IDOC membership is set to renew automatically. No action is required if you would like your membership to continue.') +
            emailInfoCard(
              emailInfoRow(IDOC_EMAIL_ICONS.calendar, 'Renewal date', renewalDate) +
              emailInfoRow(IDOC_EMAIL_ICONS.banknote, 'Renewal', 'Automatic renewal is enabled'),
            ) +
            emailNoticeCard('What happens next', '<p style="margin:0;">Your saved payment method will be charged on the renewal date. You can review your membership, update your payment method, or turn off automatic renewal from your account before then.</p>') +
            emailButton(membershipUrl, 'Manage membership'),
          footerNote: 'This is a transactional notice about your IDOC membership.',
          heading: 'Your membership renews automatically soon',
          subject: 'Your IDOC membership renews automatically soon',
        };
      }

      case 'membership.expiration_reminder': {
        const expirationDate = formatDate(payload.expirationDate);
        return {
          bodyHtml:
            membershipIntro('Your current IDOC membership term is approaching its end and is not scheduled to renew automatically.') +
            emailInfoCard(
              emailInfoRow(IDOC_EMAIL_ICONS.deadline, 'Membership expires', expirationDate) +
              emailInfoRow(IDOC_EMAIL_ICONS.banknote, 'Renewal status', 'Automatic renewal is not active'),
            ) +
            emailNoticeCard('Keep your access', '<p style="margin:0;">Renew before the expiration date to keep uninterrupted access to member features and resources.</p>') +
            emailButton(membershipUrl, 'Renew membership'),
          footerNote: 'This is a transactional notice about your IDOC membership.',
          heading: 'Your membership is expiring soon',
          subject: 'Your IDOC membership is expiring soon',
        };
      }

      case 'membership.payment_failed': {
        const graceEndDate = formatDate(payload.graceEndDate);
        return {
          bodyHtml:
            membershipIntro('We were unable to process the automatic renewal payment for your IDOC membership. Your membership remains active temporarily while the payment is retried.') +
            emailInfoCard(
              emailInfoRow(IDOC_EMAIL_ICONS.banknote, 'Payment status', 'Renewal payment unsuccessful') +
              emailInfoRow(IDOC_EMAIL_ICONS.deadline, 'Access protected through', graceEndDate),
            ) +
            emailNoticeCard('Action recommended', '<p style="margin:0;">Please review or update your payment method as soon as possible. If payment cannot be completed before the grace period ends, your membership access will expire.</p>') +
            emailButton(membershipUrl, 'Update payment method'),
          footerNote: 'If you recently updated your payment method, no further action may be necessary while the renewal is retried.',
          heading: 'We could not process your renewal',
          subject: "We couldn't process your IDOC membership renewal",
        };
      }

      case 'membership.grace_reminder': {
        const graceEndDate = formatDate(payload.graceEndDate);
        return {
          bodyHtml:
            membershipIntro('Your IDOC membership is currently in its payment grace period because the renewal payment has not been completed.') +
            emailInfoCard(
              emailInfoRow(IDOC_EMAIL_ICONS.deadline, 'Grace period ends', graceEndDate) +
              emailInfoRow(IDOC_EMAIL_ICONS.banknote, 'Payment status', 'Action required'),
            ) +
            emailNoticeCard('Avoid an interruption', '<p style="margin:0;">Update your payment method before the grace period ends so your membership can renew and your member access can continue without interruption.</p>') +
            emailButton(membershipUrl, 'Update payment method'),
          footerNote: 'This is a transactional notice about your IDOC membership.',
          heading: 'Action needed: update your payment method',
          subject: 'Action needed: update your IDOC payment method',
        };
      }

      case 'membership.grace_expired':
        return {
          bodyHtml:
            membershipIntro('Your IDOC membership has expired because the renewal payment could not be completed before the grace period ended.') +
            emailInfoCard(
              emailInfoRow(IDOC_EMAIL_ICONS.deadline, 'Membership status', 'Expired') +
              emailInfoRow(IDOC_EMAIL_ICONS.banknote, 'Next step', 'Renew to restore access'),
            ) +
            emailNoticeCard('You can return at any time', '<p style="margin:0;">Your account has not been deleted. Renew your membership whenever you are ready to restore member access.</p>') +
            emailButton(membershipUrl, 'Renew membership'),
          footerNote: 'This is a transactional notice about your IDOC membership.',
          heading: 'Your membership has expired',
          subject: 'Your IDOC membership has expired',
        };

      case 'seminar.registration_canceled':
        return {
          bodyHtml:
            `<p style="margin:0 0 18px;">${greeting}</p><p style="margin:0 0 18px;">Your IDOC seminar registration has been canceled.</p>` +
            emailInfoCard(
              emailInfoRow(IDOC_EMAIL_ICONS.calendar, 'Registration status', 'Canceled'),
            ) +
            emailNoticeCard('Payment note', '<p style="margin:0;">Canceling a registration does not automatically mean a payment has been refunded. If a refund is due, you will receive a separate confirmation when it has been processed.</p>'),
          footerNote: 'Keep this email for your records.',
          heading: 'Seminar registration canceled',
          subject: 'Your IDOC seminar cancellation',
        };

      case 'seminar.payment_confirmed':
        return {
          bodyHtml:
            `<p style="margin:0 0 18px;">${greeting}</p><p style="margin:0 0 18px;">We have recorded your seminar payment successfully.</p>` +
            emailInfoCard(
              emailInfoRow(IDOC_EMAIL_ICONS.banknote, 'Payment received', amount) +
              emailInfoRow(IDOC_EMAIL_ICONS.calendar, 'Registration status', 'Payment confirmed'),
            ) +
            emailNoticeCard('No further payment action needed', '<p style="margin:0;">Your payment is recorded against your seminar registration. Keep this confirmation for your records.</p>'),
          footerNote: 'This email confirms a payment recorded for an IDOC seminar registration.',
          heading: 'Seminar payment confirmed',
          subject: 'Your IDOC seminar payment',
        };

      case 'seminar.refund_confirmed':
        return {
          bodyHtml:
            `<p style="margin:0 0 18px;">${greeting}</p><p style="margin:0 0 18px;">Your approved seminar refund has been processed.</p>` +
            emailInfoCard(
              emailInfoRow(IDOC_EMAIL_ICONS.banknote, 'Refund amount', amount) +
              emailInfoRow(IDOC_EMAIL_ICONS.calendar, 'Refund status', 'Confirmed'),
            ) +
            emailNoticeCard('When you will see the funds', '<p style="margin:0;">The time it takes for a refund to appear depends on the original payment method and financial institution. Please keep this confirmation for your records.</p>'),
          footerNote: 'This email confirms an approved refund for an IDOC seminar registration.',
          heading: 'Seminar refund confirmed',
          subject: 'Your IDOC seminar refund',
        };

      default:
        throw new Error(`Unsupported notification kind: ${kind}`);
    }
  })();

  return {
    html: renderTransactionalEmail({
      bodyHtml,
      footerNote,
      heading,
    }),
    subject,
  };
}

export async function deliverNextRenewalNotice(owner: string = randomUUID()) {
  if (outboxDeliveryHeld()) return { status: 'blocked' as const };
  const kinds = sql.join(RENEWAL_NOTICE_KINDS.map((kind) => sql`${kind}`), sql`, `);
  const rows = await db.execute<{ attemptCount: number; id: number; kind: string; payload: NoticePayload }>(sql`
    with candidate as (select id from idoc.notification_outbox where kind in (${kinds})
      and sent_at is null and dead_lettered_at is null and available_at <= now()
      and (lease_expires_at is null or lease_expires_at < now())
      order by available_at, id for update skip locked limit 1)
    update idoc.notification_outbox o set lease_owner = ${owner}, lease_expires_at = now() + interval '5 minutes'
    from candidate where o.id = candidate.id
    returning o.id, o.attempt_count as "attemptCount", o.kind, o.payload
  `);
  const record = rows[0];
  if (!record) return { status: 'empty' as const };
  try {
    const to = record.payload.to;
    if (!to) throw new Error('not_configured');
    const { html, subject } = await renderNotice(record.kind, record.payload);
    await sendTransactionalEmail({ html, messageId: `${record.kind}-${record.id}`, subject, to });
    const finalized = await db.update(notificationOutbox).set({
      attemptCount: sql`${notificationOutbox.attemptCount} + 1`, lastAttemptAt: new Date(),
      lastErrorCode: null, leaseExpiresAt: null, leaseOwner: null, sentAt: new Date(),
    }).where(and(eq(notificationOutbox.id, record.id), eq(notificationOutbox.leaseOwner, owner), isNull(notificationOutbox.sentAt)))
      .returning({ id: notificationOutbox.id });
    return finalized.length ? { status: 'delivered' as const } : { status: 'lease_lost' as const };
  } catch {
    const attempt = record.attemptCount + 1;
    await db.update(notificationOutbox).set({
      attemptCount: attempt,
      availableAt: sql`now() + (${Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1))} * interval '1 second')`,
      deadLetteredAt: attempt >= MAX_ATTEMPTS ? new Date() : null,
      lastAttemptAt: new Date(), lastErrorCode: 'temporary_delivery_failure', leaseExpiresAt: null, leaseOwner: null,
    }).where(and(eq(notificationOutbox.id, record.id), eq(notificationOutbox.leaseOwner, owner)));
    return { status: attempt >= MAX_ATTEMPTS ? 'dead_lettered' as const : 'retryable' as const };
  }
}

export async function deliverNextStagingSeminarConfirmation(owner: string = randomUUID()) {
  if (outboxDeliveryHeld()) return { status: 'blocked' as const };
  const rows = await db.execute<{ attemptCount: number; id: number; kind: string; payload: NoticePayload }>(sql`
    with candidate as (
      select id from idoc.notification_outbox
      where kind = ${STAGING_SEMINAR_CONFIRMATION_KIND}
        and sent_at is null and dead_lettered_at is null and available_at <= now()
        and (lease_expires_at is null or lease_expires_at < now())
      order by available_at, id for update skip locked limit 1
    )
    update idoc.notification_outbox o set lease_owner = ${owner}, lease_expires_at = now() + interval '5 minutes'
    from candidate where o.id = candidate.id
    returning o.id, o.attempt_count as "attemptCount", o.kind, o.payload
  `);
  const record = rows[0];
  if (!record) return { status: 'empty' as const };
  try {
    const to = record.payload.to;
    if (!to) throw new Error('not_configured');
    const { html, subject } = await renderNotice(record.kind, record.payload);
    await sendTransactionalEmail({ html, messageId: `${record.kind}-${record.id}`, subject, to });
    const finalized = await db.update(notificationOutbox).set({
      attemptCount: sql`${notificationOutbox.attemptCount} + 1`, lastAttemptAt: new Date(),
      lastErrorCode: null, leaseExpiresAt: null, leaseOwner: null, sentAt: new Date(),
    }).where(and(eq(notificationOutbox.id, record.id), eq(notificationOutbox.leaseOwner, owner), isNull(notificationOutbox.sentAt)))
      .returning({ id: notificationOutbox.id });
    return finalized.length ? { status: 'delivered' as const } : { status: 'lease_lost' as const };
  } catch {
    const attempt = record.attemptCount + 1;
    await db.update(notificationOutbox).set({
      attemptCount: attempt,
      // Staging has no independent Vercel Cron deployment. Keep the row immediately eligible so
      // processDeliveryBatch retries it again in this same invocation instead of stranding it until
      // unrelated traffic arrives.
      availableAt: sql`now()`,
      deadLetteredAt: attempt >= MAX_ATTEMPTS ? new Date() : null,
      lastAttemptAt: new Date(), lastErrorCode: 'temporary_delivery_failure', leaseExpiresAt: null, leaseOwner: null,
    }).where(and(eq(notificationOutbox.id, record.id), eq(notificationOutbox.leaseOwner, owner)));
    return { status: attempt >= MAX_ATTEMPTS ? 'dead_lettered' as const : 'retryable' as const };
  }
}

export async function processStagingSeminarConfirmationBatch(limit = RENEWAL_NOTICE_BATCH_LIMIT) {
  return processDeliveryBatch(() => deliverNextStagingSeminarConfirmation(), limit);
}

export async function processRenewalNoticeBatch(limit = RENEWAL_NOTICE_BATCH_LIMIT) {
  return processDeliveryBatch(() => deliverNextRenewalNotice(), limit);
}
