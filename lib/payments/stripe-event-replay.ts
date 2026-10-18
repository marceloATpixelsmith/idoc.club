import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/lib/db/drizzle';
import { auditLog, reconciliationFindings, stripeEvents } from '@/lib/db/schema';
import { memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';
import { REPLAYABLE_EVENT_TYPES, processStripeEvent, type WebhookStripeClient } from './webhook-handlers';
import {
  REPLAY_MAX_EVENTS, ReplayInputError, classifyReplayEvent, describeReplayEvent, parseReplaySince, replayConfirmationPhrase, supersededEventIds, type ReplayEventStatus,
} from './stripe-event-replay-core';

// Replays Stripe events this site missed (the webhook endpoint did not exist yet, DNS pointed at the old site, or the launch hold consumed them without applying
// them). Events are read from Stripe's own List Events API with our authenticated key and applied by the very same handler a live webhook uses, so a
// payment is recorded once (payments are unique by invoice) and the paid-through date moves the same way. Nothing here writes to Stripe.

export class ReplayBlockedError extends Error {}

export type ReplayEventRow = { amountCents: number | null; createdAt: string; currency: string | null; customerId: string | null; id: string; objectId: string | null; status: ReplayEventStatus; type: string };
export type ReplayPreview = {
  byType: Record<string, number>; counts: Record<ReplayEventStatus, number>; events: ReplayEventRow[]; replayable: number; since: string; total: number; truncated: boolean;
};
export type ReplayResult = { failed: Array<{ id: string; type: string }>; ignored: number; processed: number; since: string; skipped: number };

const DISPLAY_LIMIT = 200;
const CHUNK = 500;

type ReplayStripeClient = { events: { list: (params: Stripe.EventListParams) => Promise<{ data: Stripe.Event[]; has_more: boolean }> } };

async function listEvents(stripe: ReplayStripeClient, since: Date): Promise<Stripe.Event[]> {
  const events: Stripe.Event[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await stripe.events.list({ created: { gte: Math.floor(since.getTime() / 1000) }, limit: 100, types: REPLAYABLE_EVENT_TYPES, ...(cursor ? { starting_after: cursor } : {}) });
    events.push(...page.data);
    if (events.length > REPLAY_MAX_EVENTS) throw new ReplayInputError(`More than ${REPLAY_MAX_EVENTS} events fall in that window. Start later, or replay in smaller steps.`);
    if (!page.has_more) break;
    cursor = page.data.at(-1)?.id;
    if (!cursor) break;
  }
  // Oldest first, so renewals are applied in the order they happened.
  return events.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
}

async function statusOf(events: Stripe.Event[]): Promise<Map<string, ReplayEventStatus>> {
  const received = new Set<string>();
  const blocked = new Set<string>();
  for (let index = 0; index < events.length; index += CHUNK) {
    const ids = events.slice(index, index + CHUNK).map((event) => event.id);
    for (const row of await db.select({ id: stripeEvents.externalEventId }).from(stripeEvents).where(inArray(stripeEvents.externalEventId, ids))) received.add(row.id);
    const findings = await db.select({ eventId: sql<string>`${reconciliationFindings.details} ->> 'eventId'` }).from(reconciliationFindings)
      .where(and(eq(reconciliationFindings.kind, 'status_conflict'), sql`${reconciliationFindings.details} ->> 'reason' = 'member_launch_hold'`, sql`${reconciliationFindings.details} ->> 'eventId' in ${ids}`));
    for (const row of findings) blocked.add(row.eventId);
  }
  const statuses = new Map(events.map((event) => [event.id, classifyReplayEvent(event.id, received, blocked)]));
  const superseded = supersededEventIds(events.map((event) => ({ created: event.created, customerId: describeReplayEvent(event).customerId, id: event.id, status: statuses.get(event.id) ?? 'new', type: event.type })));
  for (const id of superseded) statuses.set(id, 'superseded');
  return statuses;
}

/** Read-only: what a replay from `sinceInput` (UTC) would do. Also the "payments Stripe has that IDOC does not" check. */
export async function previewReplay(stripe: ReplayStripeClient, sinceInput: string, now: Date = new Date()): Promise<ReplayPreview> {
  const since = parseReplaySince(sinceInput, now);
  const events = await listEvents(stripe, since);
  const statuses = await statusOf(events);
  const counts: Record<ReplayEventStatus, number> = { already_processed: 0, blocked_earlier: 0, new: 0, superseded: 0 };
  const byType: Record<string, number> = {};
  const rows: ReplayEventRow[] = events.map((event) => {
    const status = statuses.get(event.id) ?? 'new';
    counts[status] += 1;
    if (status === 'new' || status === 'blocked_earlier') byType[event.type] = (byType[event.type] ?? 0) + 1;
    return { ...describeReplayEvent(event), createdAt: new Date(event.created * 1000).toISOString(), id: event.id, status, type: event.type };
  });
  const interesting = rows.filter((row) => row.status !== 'already_processed');
  return { byType, counts, events: interesting.slice(0, DISPLAY_LIMIT), replayable: counts.new + counts.blocked_earlier, since: since.toISOString(), total: rows.length, truncated: interesting.length > DISPLAY_LIMIT };
}

/** Applies the replayable events. Refuses while the launch hold is on (the handlers would only record the same blocked finding again), and only when the number of
 * replayable events still matches what the operator reviewed and confirmed. */
export async function applyReplay(input: { actorId: number; confirmation: string; expected: number; since: string; stripe: ReplayStripeClient & WebhookStripeClient; now?: Date }): Promise<ReplayResult> {
  if (memberCommunicationsDisabled()) throw new ReplayBlockedError('The member communications and billing hold is still on. Release it first: while it is on, events are only recorded as blocked again.');
  const since = parseReplaySince(input.since, input.now);
  const events = await listEvents(input.stripe, since);
  const statuses = await statusOf(events);
  const todo = events.filter((event) => ['new', 'blocked_earlier'].includes(statuses.get(event.id) ?? ''));
  if (todo.length !== input.expected) throw new ReplayBlockedError(`The number of events to replay is now ${todo.length}, not the ${input.expected} you reviewed. Run the preview again.`);
  if (input.confirmation.trim() !== replayConfirmationPhrase(todo.length)) throw new ReplayBlockedError('The confirmation text does not match.');

  const result: ReplayResult = { failed: [], ignored: 0, processed: 0, since: since.toISOString(), skipped: events.length - todo.length };
  for (const event of todo) {
    try {
      const earlier = statuses.get(event.id) === 'blocked_earlier';
      // An event the hold consumed has to be forgotten first, or the handler would see a duplicate and skip it.
      if (earlier) await db.delete(stripeEvents).where(eq(stripeEvents.externalEventId, event.id));
      const outcome = await processStripeEvent(event, input.stripe);
      if (outcome === 'processed') result.processed += 1;
      else if (outcome === 'ignored') result.ignored += 1;
      else result.failed.push({ id: event.id, type: event.type });
      if (earlier && outcome === 'processed') {
        await db.delete(reconciliationFindings).where(and(eq(reconciliationFindings.kind, 'status_conflict'), sql`${reconciliationFindings.details} ->> 'reason' = 'member_launch_hold'`, sql`${reconciliationFindings.details} ->> 'eventId' = ${event.id}`));
      }
    } catch {
      result.failed.push({ id: event.id, type: event.type });
    }
  }
  await db.insert(auditLog).values({
    actorId: input.actorId, action: 'admin.stripe_event_replay.applied', entityType: 'stripe_events', entityId: 'replay',
    afterJson: { failed: result.failed.slice(0, 50), failedCount: result.failed.length, ignored: result.ignored, processed: result.processed, since: result.since, skipped: result.skipped },
    reason: 'Missed Stripe events replayed by a Super Admin.',
  });
  return result;
}
