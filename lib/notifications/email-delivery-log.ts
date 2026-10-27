import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { emailDeliveryEvents, emailDeliveryLog } from '@/lib/db/schema';
import { type DeliveryEventName, recipientDomain, statusAfterEvent } from './email-delivery-log-core';

export type AcceptedEmail = { kind?: string | null; messageRef?: string | null; providerMessageId: string | null; subject: string; to: string; userId?: number | null };

/** Records one email Brevo has just accepted. The caller treats this as best effort: the email is already sent, so a failure here
 * must never turn a delivered message into an error. */
export async function recordAcceptedEmail(input: AcceptedEmail): Promise<void> {
  const email = input.to.trim().toLowerCase();
  await db.insert(emailDeliveryLog).values({
    kind: input.kind?.slice(0, 60) ?? null,
    messageRef: input.messageRef?.slice(0, 100) ?? null,
    providerMessageId: input.providerMessageId,
    recipientDomain: recipientDomain(email),
    recipientEmail: email.slice(0, 255),
    subject: input.subject.slice(0, 255),
    userId: input.userId ?? null,
  }).onConflictDoNothing();
}

export type DeliveryEventResult = 'applied' | 'duplicate' | 'unknown_message';

/** Applies one Brevo webhook event to the logged email it belongs to: appends it to the history (a redelivered webhook is a no-op)
 * and moves the email's status forward when the event outranks it. An event for a message this log never recorded (sent before
 * logging began, or by another system) is reported as unknown and otherwise ignored. */
export async function applyBrevoDeliveryEvent(input: { event: DeliveryEventName; messageId: string; occurredAt: Date; reason?: string }): Promise<DeliveryEventResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ deliveredAt: emailDeliveryLog.deliveredAt, id: emailDeliveryLog.id, status: emailDeliveryLog.status })
      .from(emailDeliveryLog).where(eq(emailDeliveryLog.providerMessageId, input.messageId)).for('update');
    if (!row) return 'unknown_message';
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
  });
}
