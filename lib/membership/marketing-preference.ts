import 'server-only';

import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, onboardingConsents, profiles, users } from '@/lib/db/schema';
import {
  listMarketingMembersByStatus,
  requestMarketingOptIn,
  requestMarketingOptOut,
  type MarketingOptInOutcome,
  type MarketingOptOutOutcome,
} from '@/lib/notifications/mailchimp-marketing';

/**
 * The member's "keep me updated" marketing choice (docs/19). `onboarding_consents.keep_updated_opt_in`
 * is true only while Mailchimp holds the member as subscribed. An opt-in that Mailchimp answered with
 * a confirmation email stays false, with `keep_updated_pending_at` set, until the member clicks it and
 * the webhook or reconciliation reports `subscribed`. Nothing here touches transactional email,
 * billing or entitlement: the flag only describes the Mailchimp marketing audience.
 */

export type MarketingPreferenceSource = 'admin' | 'mailchimp_reconciliation' | 'mailchimp_webhook' | 'member';

export type MarketingPreference = { changedAt: Date | null; optIn: boolean; pending: boolean; source: string | null };

export async function getMarketingPreference(profileId: number): Promise<MarketingPreference | null> {
  const [row] = await db.select({
    changedAt: onboardingConsents.keepUpdatedChangedAt,
    optIn: onboardingConsents.keepUpdatedOptIn,
    pendingAt: onboardingConsents.keepUpdatedPendingAt,
    source: onboardingConsents.keepUpdatedSource,
  }).from(onboardingConsents).where(eq(onboardingConsents.profileId, profileId)).limit(1);
  return row ? { changedAt: row.changedAt, optIn: row.optIn, pending: row.pendingAt !== null, source: row.source } : null;
}

export type ChangeMarketingPreferenceResult =
  | { status: 'cleaned' | 'failed' | 'unavailable' | 'blocked'; synced: false }
  | { status: 'no_consent_record' | 'pending' | 'unchanged'; synced: boolean }
  | { status: 'opted_in'; synced: true }
  | { status: 'opted_out'; synced: boolean };

/**
 * Applies a member's (or an administrator's) choice. Opting out always takes effect locally, even
 * when Mailchimp cannot be reached, because honoring the member's choice must not depend on a
 * third party; `synced` tells the caller whether Mailchimp confirmed it. Opting in only takes effect
 * once Mailchimp agrees: a member who unsubscribed themselves is sent a confirmation email and stays
 * opted out until they click it. Callers perform ownership/administrator authorization first.
 */
export async function changeMarketingPreference(input: {
  actorId: number;
  desired: boolean;
  profileId: number;
  reason?: string;
  source: Extract<MarketingPreferenceSource, 'admin' | 'member'>;
}): Promise<ChangeMarketingPreferenceResult> {
  const [row] = await db.select({
    email: users.email,
    optIn: onboardingConsents.keepUpdatedOptIn,
    pendingAt: onboardingConsents.keepUpdatedPendingAt,
  }).from(onboardingConsents)
    .innerJoin(profiles, eq(profiles.id, onboardingConsents.profileId))
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(onboardingConsents.profileId, input.profileId)).limit(1);
  if (!row) return { status: 'no_consent_record', synced: false };

  if (input.desired) {
    if (row.optIn) return { status: 'unchanged', synced: true };
    if (row.pendingAt !== null) return { status: 'pending', synced: true };
    const outcome: MarketingOptInOutcome = await requestMarketingOptIn(row.email);
    if (outcome === 'subscribed') {
      await writePreference(input, row, { optIn: true, pending: false });
      return { status: 'opted_in', synced: true };
    }
    if (outcome === 'pending') {
      await writePreference(input, row, { optIn: false, pending: true });
      return { status: 'pending', synced: true };
    }
    return { status: outcome, synced: false };
  }

  if (!row.optIn && row.pendingAt === null) return { status: 'unchanged', synced: true };
  await writePreference(input, row, { optIn: false, pending: false });
  const outcome: MarketingOptOutOutcome = await requestMarketingOptOut(row.email);
  return { status: 'opted_out', synced: outcome === 'unsubscribed' || outcome === 'not_found' };
}

/**
 * Best-effort follow-up to an opted-in onboarding (the consent row already records the choice, so a
 * provider problem changes nothing). Where Mailchimp cannot take the member straight to subscribed,
 * the stored flag is corrected so it never claims a subscription that does not exist: a member who
 * earlier unsubscribed themselves is sent a confirmation email (flag false until they click it), and
 * an undeliverable address is recorded as opted out. Never throws and never affects onboarding.
 */
export async function settleOnboardingMarketingOptIn(profileId: number, email: string): Promise<void> {
  try {
    const outcome = await requestMarketingOptIn(email);
    if (outcome !== 'pending' && outcome !== 'cleaned') return;
    const now = new Date();
    await db.update(onboardingConsents).set({
      keepUpdatedChangedAt: now,
      keepUpdatedOptIn: false,
      keepUpdatedPendingAt: outcome === 'pending' ? now : null,
      keepUpdatedSource: 'member',
    }).where(eq(onboardingConsents.profileId, profileId));
  } catch {
    // Marketing sync is deliberately isolated from onboarding and billing.
  }
}

async function writePreference(
  input: { actorId: number; profileId: number; reason?: string; source: MarketingPreferenceSource },
  before: { optIn: boolean; pendingAt: Date | null },
  after: { optIn: boolean; pending: boolean },
) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(onboardingConsents).set({
      keepUpdatedChangedAt: now,
      keepUpdatedOptIn: after.optIn,
      keepUpdatedPendingAt: after.pending ? now : null,
      keepUpdatedSource: input.source,
    }).where(eq(onboardingConsents.profileId, input.profileId));
    await tx.insert(auditLog).values({
      action: 'member.marketing_preference.changed',
      actorId: input.actorId,
      afterJson: { optIn: after.optIn, pending: after.pending, source: input.source },
      beforeJson: { optIn: before.optIn, pending: before.pendingAt !== null },
      entityId: String(input.profileId),
      entityType: 'profile',
      reason: input.reason ?? null,
    });
  });
}

/**
 * Records what Mailchimp reports. An unsubscribe or a cleaned (permanently undeliverable) address
 * always clears the flag. A `subscribed` report only completes an opt-in the member started and is
 * still waiting on: it never turns the flag back on for a member who chose to opt out here while
 * Mailchimp still listed them. Returns the profile ids that changed.
 */
export async function applyMailchimpMarketingStatus(
  emails: readonly string[],
  status: 'cleaned' | 'subscribed' | 'unsubscribed',
  source: Extract<MarketingPreferenceSource, 'mailchimp_reconciliation' | 'mailchimp_webhook'>,
): Promise<number[]> {
  const normalized = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.length > 0))];
  if (normalized.length === 0) return [];
  const changed: number[] = [];
  const now = new Date();
  for (let start = 0; start < normalized.length; start += 500) {
    const chunk = normalized.slice(start, start + 500);
    const matching = db.select({ id: profiles.id }).from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(inArray(sql`lower(${users.email})`, chunk));
    const optingOut = status !== 'subscribed';
    const rows = await db.update(onboardingConsents).set({
      keepUpdatedChangedAt: now,
      keepUpdatedOptIn: !optingOut,
      keepUpdatedPendingAt: null,
      keepUpdatedSource: source,
    }).where(and(
      inArray(onboardingConsents.profileId, matching),
      optingOut
        ? or(eq(onboardingConsents.keepUpdatedOptIn, true), isNotNull(onboardingConsents.keepUpdatedPendingAt))
        : isNotNull(onboardingConsents.keepUpdatedPendingAt),
    )).returning({ profileId: onboardingConsents.profileId });
    if (rows.length === 0) continue;
    await db.insert(auditLog).values(rows.map(({ profileId }) => ({
      action: 'member.marketing_preference.changed',
      actorId: null,
      afterJson: { mailchimpStatus: status, optIn: !optingOut, source },
      beforeJson: null,
      entityId: String(profileId),
      entityType: 'profile',
    })));
    changed.push(...rows.map(({ profileId }) => profileId));
  }
  return changed;
}

/**
 * Daily safety net (and one-time backfill): reads every unsubscribed and cleaned address from
 * Mailchimp and clears the flag for matching members, then completes any opt-in whose confirmation
 * email was clicked. It never re-subscribes anyone and never calls back into Mailchimp to change a
 * status. Throws if Mailchimp cannot be read so the run is reported as failed, not as "nobody
 * unsubscribed".
 */
export async function reconcileMarketingPreferences(): Promise<Record<string, number>> {
  const [unsubscribed, cleaned] = await Promise.all([
    listMarketingMembersByStatus('unsubscribed'),
    listMarketingMembersByStatus('cleaned'),
  ]);
  const optedOut = await applyMailchimpMarketingStatus(unsubscribed.map(({ email }) => email), 'unsubscribed', 'mailchimp_reconciliation');
  const bounced = await applyMailchimpMarketingStatus(cleaned.map(({ email }) => email), 'cleaned', 'mailchimp_reconciliation');

  const waiting = await db.select({ email: users.email }).from(onboardingConsents)
    .innerJoin(profiles, eq(profiles.id, onboardingConsents.profileId))
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(isNotNull(onboardingConsents.keepUpdatedPendingAt));
  let confirmed = 0;
  if (waiting.length > 0) {
    const subscribed = new Set((await listMarketingMembersByStatus('subscribed')).map(({ email }) => email));
    const nowSubscribed = waiting.map(({ email }) => email.toLowerCase()).filter((email) => subscribed.has(email));
    confirmed = (await applyMailchimpMarketingStatus(nowSubscribed, 'subscribed', 'mailchimp_reconciliation')).length;
  }
  return { bounced: bounced.length, confirmed, optedOut: optedOut.length, unsubscribedInMailchimp: unsubscribed.length };
}
