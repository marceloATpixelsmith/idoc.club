import 'server-only';

import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { userActivityEvents } from '@/lib/db/schema';
import { currentRequestId } from '@/lib/observability/request-id';
import { canonicalActivityDetail, sanitizeActivityDetail, type UserActivityDetail, type UserActivityEvent } from './user-activity-events';

const DEDUPE_WINDOW_MS = 60_000;

/** Records one member activity event. Best-effort by design: it must never make the request it observes fail or slow
 * down, so every failure is swallowed. A repeat of the same event and outcome for the same member within a minute (a
 * page re-render, a prefetch) is recorded once. */
export async function recordUserActivity(userId: number, event: UserActivityEvent, options: { detail?: UserActivityDetail; outcome?: string } = {}): Promise<void> {
  try {
    const outcome = options.outcome?.slice(0, 40) ?? null;
    const detail = sanitizeActivityDetail(options.detail as Record<string, unknown> | undefined);
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const recent = await db.select({ detail: userActivityEvents.detail, outcome: userActivityEvents.outcome }).from(userActivityEvents)
      .where(and(eq(userActivityEvents.userId, userId), eq(userActivityEvents.event, event), gt(userActivityEvents.occurredAt, since)));
    if (recent.some((row) => row.outcome === outcome && canonicalActivityDetail(row.detail as Record<string, unknown> | null) === canonicalActivityDetail(detail))) return;
    await db.insert(userActivityEvents).values({
      detail,
      event,
      outcome,
      requestId: await currentRequestId(),
      userId,
    });
  } catch {
    // Observability must not become an outage.
  }
}
