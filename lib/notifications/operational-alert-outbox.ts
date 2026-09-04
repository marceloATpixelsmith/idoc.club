import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';

// AUTH-OPERATIONS-006: a Codex review caught that the rate-limit correlation alert's email send was
// awaited directly inside checkRateLimit -- the authentication-adjacent hot path every sign-in,
// sign-up, and password-reset request runs through -- so an unbounded or slow Brevo call could
// hold every one of those requests open. This module is the durable, leased, concurrency-safe queue
// that decouples "detect the sustained pattern and durably record that an alert is owed" (fast: one
// indexed insert, still on the hot path but bounded and already-paid-for by the same database this
// path already talks to) from "actually deliver the email" (moved off the hot path entirely, onto
// the same lease-and-retry worker pattern already proven for idoc.auth_security_notification_outbox
// -- see operational-alert-delivery.ts).

export type OperationalAlertKind = 'incident_response_action_taken' | 'rate_limit_correlation_alert';

/** Fast, transactional, idempotent: a duplicate dedupeKey is silently absorbed (the caller has
 * already decided this exact alert should exist at most once), never a slow network call. */
export async function enqueueOperationalAlert(input: {
  bodyHtml: string;
  dedupeKey: string;
  kind: OperationalAlertKind;
  subject: string;
}): Promise<boolean> {
  const rows = await db.execute<{ id: number }>(sql`
    insert into idoc.operational_alert_outbox(kind,subject,body_html,dedupe_key)
    values (${input.kind},${input.subject},${input.bodyHtml},${input.dedupeKey})
    on conflict (dedupe_key) do nothing
    returning id
  `);
  return Boolean(rows[0]);
}
