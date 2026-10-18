// Pure helpers for the Super Admin Stripe event replay (docs/07, switchover runbook). No server-only imports so the unit tests can load it.

export const REPLAY_MAX_LOOKBACK_DAYS = 30;
export const REPLAY_MAX_EVENTS = 500;
/** Stripe only keeps events for 30 days; the window is cut a little short so a boundary event is never half-listed. */
const LOOKBACK_MS = (REPLAY_MAX_LOOKBACK_DAYS - 1) * 24 * 60 * 60 * 1000;

export class ReplayInputError extends Error {}

/** `since` is a UTC date and time such as 2026-10-22T09:30 (the moment the WordPress export was taken). */
export function parseReplaySince(input: string, now: Date = new Date()): Date {
  const text = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?Z?$/.test(text)) throw new ReplayInputError('Enter the start as a UTC date and time, for example 2026-10-22 09:30.');
  const since = new Date(`${text.replace(' ', 'T').replace(/Z$/, '')}${/:\d{2}:\d{2}$/.test(text.replace(/Z$/, '')) ? '' : ':00'}Z`);
  if (Number.isNaN(since.getTime())) throw new ReplayInputError('That date and time is not valid.');
  if (since.getTime() > now.getTime()) throw new ReplayInputError('The start is in the future.');
  if (now.getTime() - since.getTime() > LOOKBACK_MS) throw new ReplayInputError(`Stripe only keeps events for ${REPLAY_MAX_LOOKBACK_DAYS} days, so the start must be within the last ${REPLAY_MAX_LOOKBACK_DAYS - 1}.`);
  return since;
}

export type ReplayEventStatus = 'new' | 'blocked_earlier' | 'already_processed' | 'superseded';

/** `new`: this site never received it (the webhook endpoint did not exist yet, or DNS pointed elsewhere). `blocked_earlier`: it arrived while the launch hold was on and was
 * consumed without being applied (the hold recorded a finding naming it). `already_processed`: applied before; replaying would do nothing. */
export function classifyReplayEvent(eventId: string, receivedIds: ReadonlySet<string>, blockedIds: ReadonlySet<string>): ReplayEventStatus {
  if (!receivedIds.has(eventId)) return 'new';
  return blockedIds.has(eventId) ? 'blocked_earlier' : 'already_processed';
}

type EventLike = { created: number; data: { object: unknown }; id: string; type: string };

/** What a person needs to recognise the payment: amount, currency, Stripe customer and the object ID. */
export function describeReplayEvent(event: EventLike): { amountCents: number | null; currency: string | null; customerId: string | null; objectId: string | null } {
  const object = event.data.object && typeof event.data.object === 'object' ? event.data.object as Record<string, unknown> : {};
  const customer = object.customer;
  const amount = [object.amount_paid, object.amount_total, object.amount, object.amount_received].find((value) => typeof value === 'number');
  return {
    amountCents: typeof amount === 'number' ? amount : null,
    currency: typeof object.currency === 'string' ? object.currency.toUpperCase() : null,
    customerId: typeof customer === 'string' ? customer : customer && typeof customer === 'object' && typeof (customer as { id?: unknown }).id === 'string' ? (customer as { id: string }).id : null,
    objectId: typeof object.id === 'string' ? object.id : null,
  };
}

export const replayConfirmationPhrase = (count: number) => `REPLAY ${count} EVENTS`;

/** State-changing events. A payment (`invoice.paid`) is never superseded: money received still has to be recorded however late it is found, and recording it is
 * additive. The others describe a state at a moment, so an older one must never overwrite what a newer, already applied event for the same customer set. */
const STATE_EVENT_TYPES = new Set(['invoice.payment_failed', 'invoice.payment_action_required', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);
const ORDERING_EVENT_TYPES = new Set([...STATE_EVENT_TYPES, 'invoice.paid']);

/** Ids of replayable events that a newer, already applied event for the same customer has overtaken (for example a missed `invoice.payment_failed` when the
 * customer's later `invoice.paid` was delivered normally). They are listed but not replayed. */
export function supersededEventIds(events: Array<{ created: number; customerId: string | null; id: string; status: ReplayEventStatus; type: string }>): Set<string> {
  const superseded = new Set<string>();
  for (const event of events) {
    if (event.status === 'already_processed' || !STATE_EVENT_TYPES.has(event.type) || !event.customerId) continue;
    if (events.some((other) => other.status === 'already_processed' && other.customerId === event.customerId && other.created > event.created && ORDERING_EVENT_TYPES.has(other.type))) superseded.add(event.id);
  }
  return superseded;
}
