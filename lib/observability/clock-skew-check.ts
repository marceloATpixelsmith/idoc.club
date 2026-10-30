import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { escapeHtml, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { sendTransactionalEmail } from '@/lib/notifications/brevo-transactional';
import { taggedSubject } from '@/lib/notifications/alert-severity';
import { logError } from './logger';

// AUTH-OPERATIONS-008: "Revocation, consumption, replay, roles, memberships, authorization versions,
// rate limits and key state MUST be cross-instance consistent and use monitored trusted UTC time with
// bounded skew." Cross-instance consistency already follows architecturally from a single
// authoritative Postgres instance with no per-app-server caching (see docs/22's own row for this
// control). "Monitored ... bounded skew" was the missing half: nothing ever compared the application
// server's own clock -- the clock every session/challenge/pending-auth-cookie expiry, rate-limit
// window boundary, and TOTP counter window in this codebase is computed from -- against any
// independent reference. This module is that monitor: Postgres's own `now()` serves as the trusted
// reference clock (a managed database server's clock is operationally trustworthy in a way an
// arbitrary compute instance's is not), and a skew beyond the bound pages an operator.

const SKEW_THRESHOLD_MS = 5_000;
const ALERT_DELIVERY_TIMEOUT_MS = 5_000;
const SKEW_SAMPLE_COUNT = 5;

export type ClockSkewMeasurement = { skewMs: number; roundTripMs: number };

/** One sample: the app clock's midpoint of the query round trip, minus the database's own clock. */
async function sampleClockSkew(): Promise<ClockSkewMeasurement> {
  const requestedAt = Date.now();
  // clock_timestamp(), not now(): now() is the start time of the current transaction, so it can lag
  // the real database time; clock_timestamp() is the database's wall clock when the statement runs.
  const rows = await db.execute<{ db_now: string }>(sql`select clock_timestamp() as db_now`);
  const respondedAt = Date.now();
  const dbNowMs = new Date(rows[0].db_now).getTime();
  // The database read its clock at some unknown point inside the round trip. The midpoint is the best
  // single estimate, but it is only accurate to within half the round trip either way.
  const appNowMs = Math.round((requestedAt + respondedAt) / 2);
  return { skewMs: appNowMs - dbNowMs, roundTripMs: respondedAt - requestedAt };
}

/** NTP-style measurement: take several samples and keep the one with the shortest round trip, since a
 * slow round trip (a cold or frozen serverless instance, a blocked event loop, a slow connection) makes
 * the midpoint estimate unreliable. A single slow sample once produced a false 7223ms "ahead" alert. */
export async function measureClockSkewMs(): Promise<ClockSkewMeasurement> {
  let best = await sampleClockSkew();
  for (let i = 1; i < SKEW_SAMPLE_COUNT; i++) {
    const sample = await sampleClockSkew();
    if (sample.roundTripMs < best.roundTripMs) best = sample;
  }
  return best;
}

/** Skew that is certain even in the worst case: the measured skew minus its half-round-trip error. */
export function provenSkewMs({ skewMs, roundTripMs }: ClockSkewMeasurement): number {
  return Math.max(0, Math.abs(skewMs) - roundTripMs / 2);
}

/** Best-effort: never throws, and a delivery/measurement failure is logged rather than treated as
 * skew itself (a database that is briefly unreachable is a different, already-monitored failure mode,
 * not evidence of clock drift). */
export async function runClockSkewCheck(): Promise<{ alerted: number; skewMs: number; roundTripMs: number }> {
  try {
    const measurement = await measureClockSkewMs();
    const { skewMs, roundTripMs } = measurement;
    // Alert only when the skew exceeds the bound even after allowing for the measurement's own error,
    // so a slow probe can no longer page an operator about drift that never happened.
    if (provenSkewMs(measurement) <= SKEW_THRESHOLD_MS) return { alerted: 0, skewMs, roundTripMs };

    const to = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
    if (!to) return { alerted: 0, skewMs, roundTripMs };
    const direction = skewMs > 0 ? 'ahead of' : 'behind';
    const html = renderTransactionalEmail({
      bodyHtml: `<p>The application server's clock is currently <b>${escapeHtml(String(Math.abs(skewMs)))}ms</b> ${direction} the database's clock, exceeding the ${SKEW_THRESHOLD_MS}ms bound (measured with a ${escapeHtml(String(roundTripMs))}ms query round trip, so the error is at most ${escapeHtml(String(Math.round(roundTripMs / 2)))}ms).</p>
<p>Every session, MFA challenge, pending-authentication cookie, and rate-limit window boundary in this codebase is computed from the application server's own clock. Sustained drift beyond this bound risks premature expiry or, in the other direction, a token or window outliving its intended lifetime.</p>
<p>Check the deployment platform's clock synchronization for this instance. This alone is not evidence of an attack.</p>`,
      footerNote: 'IDOC operational monitoring.',
      heading: 'Application/database clock skew detected',
    });
    // A Codex review on this pull request caught that an unbounded delivery call here could hold the
    // cron invocation open until the platform itself kills it, so the catch below might never actually
    // run (and clock_skew_check_failed would never be recorded) -- matching the timeout pattern already
    // established in google-oauth-failure-alert.ts's own alert delivery.
    await sendTransactionalEmail({
      html, to,
      subject: taggedSubject('auth.clock_skew_detected', `IDOC: clock skew detected (${Math.abs(skewMs)}ms ${direction} database)`),
    }, { signal: AbortSignal.timeout(ALERT_DELIVERY_TIMEOUT_MS) });
    return { alerted: 1, skewMs, roundTripMs };
  } catch {
    await logError('clock_skew_check_failed');
    return { alerted: 0, skewMs: 0, roundTripMs: 0 };
  }
}
