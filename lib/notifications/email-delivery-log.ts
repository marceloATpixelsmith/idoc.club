import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { emailDeliveryEvents, emailDeliveryLog, emailDeliveryPendingEvents } from '@/lib/db/schema';
import { type DeliveryEventName, recipientDomain, statusAfterEvent } from './email-delivery-log-core';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AcceptedEmail = { kind?: string | null; messageRef?: string | null; providerMessageId: string | null; subject: string; to: string; userId?: number | null };
export type DeliveryEvent = { event: DeliveryEventName; messageId: string; occurredAt: Date; reason?: string };
export type DeliveryEventResult = 'applied' | 'duplicate' | 'held';

/** Applies one event to a logged email: appends it to the history (a repeat is a no-op) and moves the status forward when the event
 * outranks it. */
async function applyToLoggedEmail(tx: Transaction, row: { deliveredAt: Date | null; id: number; status: string }, input: DeliveryEvent): Promise<'applied' | 'duplicate'> {
  const inserted = await tx.insert(emailDeliveryEvents).values({
    event: input.event, logId: row.id, occurredAt: input.occurredAt, reason: input.reason?.slice(0, 200) ?? null,
  }).onConflictDoNothing().returning({ id: emailDeliveryEvents.id });
  if (inserted.length === 0) return 'duplicate';
  const status = statusAfterEvent(row.status as Parameters<typeof statusAfterEvent>[0], input.event);
  const changes = {
    ...(status !== row.status ? { status, statusAt: input.occurredAt } : {}),
    ...(input.event === 'delivered' && !row.deliveredAt ? { deliveredAt: input.occurredAt } : {}),
  };
  if (Object.keys(changes).length > 0) await tx.update(emailDeliveryLog).set(changes).where(eq(emailDeliveryLog.id, row.id));
  return 'applied';
}

/** Records one email Brevo has just accepted, then applies any webhook event that reached us before this insert committed (Brevo can
 * report a message a moment before the send's own write finishes). The caller treats this as best effort: the email is already sent,
 * so a failure here must never turn a delivered message into an error. */
export async function recordAcceptedEmail(input: AcceptedEmail): Promise<void> {
  const email = input.to.trim().toLowerCase();
  await db.transaction(async (tx) => {
    const [created] = await tx.insert(emailDeliveryLog).values({
      kind: input.kind?.slice(0, 60) ?? null,
      messageRef: input.messageRef?.slice(0, 100) ?? null,
      providerMessageId: input.providerMessageId,
      recipientDomain: recipientDomain(email),
      recipientEmail: email.slice(0, 255),
      subject: input.subject.slice(0, 255),
      userId: input.userId ?? null,
    }).onConflictDoNothing().returning({ deliveredAt: emailDeliveryLog.deliveredAt, id: emailDeliveryLog.id, status: emailDeliveryLog.status });
    if (!created || !input.providerMessageId) return;
    const held = await tx.select().from(emailDeliveryPendingEvents)
      .where(eq(emailDeliveryPendingEvents.providerMessageId, input.providerMessageId)).orderBy(emailDeliveryPendingEvents.occurredAt);
    let current = created;
    for (const event of held) {
      await applyToLoggedEmail(tx, current, { event: event.event as DeliveryEventName, messageId: input.providerMessageId, occurredAt: event.occurredAt, reason: event.reason ?? undefined });
      const [fresh] = await tx.select({ deliveredAt: emailDeliveryLog.deliveredAt, id: emailDeliveryLog.id, status: emailDeliveryLog.status }).from(emailDeliveryLog).where(eq(emailDeliveryLog.id, created.id));
      current = fresh ?? current;
    }
    if (held.length > 0) await tx.delete(emailDeliveryPendingEvents).where(eq(emailDeliveryPendingEvents.providerMessageId, input.providerMessageId));
  });
}

/** Applies one Brevo webhook event to the logged email it belongs to. An event for a message not logged yet is held (not dropped) and
 * applied when the send is logged, or discarded after two days if that never happens (a message sent before logging began). */
export async function applyBrevoDeliveryEvent(input: DeliveryEvent): Promise<DeliveryEventResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ deliveredAt: emailDeliveryLog.deliveredAt, id: emailDeliveryLog.id, status: emailDeliveryLog.status })
      .from(emailDeliveryLog).where(eq(emailDeliveryLog.providerMessageId, input.messageId)).for('update');
    if (!row) {
      await tx.insert(emailDeliveryPendingEvents).values({
        event: input.event, occurredAt: input.occurredAt, providerMessageId: input.messageId, reason: input.reason?.slice(0, 200) ?? null,
      }).onConflictDoNothing();
      return 'held';
    }
    return applyToLoggedEmail(tx, row, input);
  });
}
