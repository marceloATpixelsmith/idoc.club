import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { notificationOutbox, profiles, users } from '@/lib/db/schema';
import { OPEN_SUBSCRIPTION_STATUSES } from '@/lib/payments/pricing';
import { AUTO_RENEWAL_NOTICE_DAYS, GRACE_REMINDER_DAYS_BEFORE_END, NON_RENEWAL_EXPIRATION_NOTICE_DAYS } from '@/lib/payments/renewal';
import { sendTransactionalEmail } from './mailchimp-transactional';
import { processDeliveryBatch } from './account-delivery-worker-core';

export const RENEWAL_NOTICE_BATCH_LIMIT = 20;
const GRACE_EXPIRY_BATCH_LIMIT = 500;
const MAX_ATTEMPTS = 6;
const RENEWAL_NOTICE_KINDS = [
  'membership.renewal_reminder',
  'membership.expiration_reminder',
  'membership.payment_failed',
  'membership.grace_reminder',
  'membership.grace_expired',
] as const;

type NoticePayload = {
  expirationDate?: string;
  firstName?: string | null;
  graceEndDate?: string;
  renewalDate?: string;
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
    where m.status in ('active', 'complimentary', 'canceled')
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
      jsonb_build_object('to', u.email, 'firstName', p.first_name, 'graceEndDate', m.valid_until),
      'membership.grace_reminder:' || m.profile_id || ':' || m.valid_until
    from idoc.memberships m
    join idoc.profiles p on p.id = m.profile_id
    join idoc.users u on u.id = p.user_id
    where m.status = 'grace'
      and (m.valid_until - ${GRACE_REMINDER_DAYS_BEFORE_END}::int) <= ${today}::date
      and m.valid_until > ${today}::date
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
        where status = 'grace' and valid_until <= ${today}::date
        order by id for update skip locked limit 1
      )
      update idoc.memberships m set status = 'expired', updated_at = now()
      from candidate where m.id = candidate.id
      returning m.id, m.profile_id as "profileId", m.valid_until as "validUntil"
    `);
    if (!expired) break;
    const [contact] = await db.select({ email: users.email, firstName: profiles.firstName })
      .from(profiles).innerJoin(users, eq(profiles.userId, users.id)).where(eq(profiles.id, expired.profileId)).limit(1);
    await db.insert(notificationOutbox).values({
      dedupeKey: `membership.grace_expired:${expired.profileId}:${expired.validUntil}`,
      kind: 'membership.grace_expired',
      payload: { firstName: contact?.firstName, to: contact?.email },
      profileId: expired.profileId,
    }).onConflictDoNothing({ target: notificationOutbox.dedupeKey });
    count += 1;
  }
  return count;
}

export async function enqueueRenewalNotices(today: string = todayIso()) {
  const [renewalReminders, expirationReminders, graceReminders, graceExpired] = await Promise.all([
    enqueueRenewalReminders(today),
    enqueueExpirationReminders(today),
    enqueueGraceReminders(today),
    transitionExpiredGraceMemberships(today),
  ]);
  return { expirationReminders, graceExpired, graceReminders, renewalReminders };
}

function renderNotice(kind: string, payload: NoticePayload): { html: string; subject: string } {
  const greeting = payload.firstName ? `Hello ${payload.firstName},` : 'Hello,';
  switch (kind) {
    case 'membership.renewal_reminder':
      return {
        html: `<p>${greeting}</p><p>Your IDOC membership will renew automatically on ${payload.renewalDate}. No action is needed — you can manage your payment method or turn off automatic renewal any time from your account.</p>`,
        subject: 'Your IDOC membership renews automatically soon',
      };
    case 'membership.expiration_reminder':
      return {
        html: `<p>${greeting}</p><p>Your IDOC membership expires on ${payload.expirationDate}. Renew before then to keep your access.</p>`,
        subject: 'Your IDOC membership is expiring soon',
      };
    case 'membership.payment_failed':
      return {
        html: `<p>${greeting}</p><p>We were unable to process your automatic IDOC membership renewal. You remain active through ${payload.graceEndDate} while payment is retried — please update your payment method to avoid an interruption.</p>`,
        subject: "We couldn't process your IDOC membership renewal",
      };
    case 'membership.grace_reminder':
      return {
        html: `<p>${greeting}</p><p>Your IDOC membership will expire on ${payload.graceEndDate} unless your payment method is updated before then.</p>`,
        subject: 'Action needed: update your IDOC payment method',
      };
    case 'membership.grace_expired':
    default:
      return {
        html: `<p>${greeting}</p><p>Your IDOC membership has expired because payment could not be completed. You can renew any time to restore your access.</p>`,
        subject: 'Your IDOC membership has expired',
      };
  }
}

export async function deliverNextRenewalNotice(owner: string = randomUUID()) {
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
    const { html, subject } = renderNotice(record.kind, record.payload);
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

export async function processRenewalNoticeBatch(limit = RENEWAL_NOTICE_BATCH_LIMIT) {
  return processDeliveryBatch(() => deliverNextRenewalNotice(), limit);
}
