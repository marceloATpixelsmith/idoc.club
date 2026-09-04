import 'server-only';

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { escapeHtml, renderTransactionalEmail } from './email-template';
import { enqueueOperationalAlert } from './operational-alert-outbox';
import { taggedSubject } from './alert-severity';
import { logWarn } from '@/lib/observability/logger';

// AUTH-OPERATIONS-006: correlates repeated rate-limit exceedances of the same auth-security bucket
// across multiple time windows into a single operator alert. A single blocked request is routine
// (rate limiting itself already handled it); the alert-worthy signal is *sustained* blocking of the
// same identity/origin across consecutive windows, which is the actual shape of a live
// credential-stuffing or brute-force attempt rather than an ordinary user mistake. This deliberately
// does not attempt general anomaly detection -- only this one, narrow, real correlation over data
// this codebase already records in idoc.account_request_limits.
//
// A Codex review caught that the original version both (a) awaited the actual Brevo send
// directly inside this function, which checkRateLimit calls on the authentication-adjacent hot path
// every sign-in/sign-up/password-reset request runs through, and (b) had no durable retry: a
// transient send failure was only ever logged, never retried. This version enqueues into
// idoc.operational_alert_outbox (a fast, single indexed insert) and lets the existing
// lease-and-retry worker (operational-alert-delivery.ts, piggybacked on the account-delivery cron
// exactly like idoc.auth_security_notification_outbox already is) perform the actual network call
// off the request path entirely. The outbox's own dedupe_key unique index -- scoped to this purpose,
// bucket, and hour-long cooldown window -- replaces the previous bespoke, race-prone
// check-then-write cooldown mechanism with a single atomic insert.

const WINDOW_MS = 15 * 60 * 1000; // must match lib/security/rate-limit.ts's own WINDOW_MS
const LOOKBACK_WINDOWS = 4; // the last hour
const BLOCKED_WINDOW_THRESHOLD = 3; // blocked in 3 of the last 4 windows -- sustained, not a blip
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // at most one alert per bucket per hour

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Called by checkRateLimit whenever one of its two buckets just denied a request. Best-effort only
 * -- never throws, never changes the caller's own rate-limit decision (which already happened), and
 * never includes the raw email/IP, only their existing HMAC-like digests already used as the bucket
 * key (no new sensitive material is introduced or retained). The only work on the calling request's
 * critical path is the blocked-windows count query and, at most once per bucket per hour, a single
 * indexed insert -- never a network call. */
export async function correlateRepeatedRateLimitExceedance(input: {
  identifierHash: string;
  max: number;
  now?: Date;
  originHash: string;
  purpose: string;
}): Promise<void> {
  const now = input.now ?? new Date();
  try {
    const lookbackStart = new Date(now.getTime() - LOOKBACK_WINDOWS * WINDOW_MS);
    const rows = await db.execute<{ blocked_windows: number }>(sql`
      select count(*)::int as blocked_windows from idoc.account_request_limits
      where purpose=${input.purpose} and identifier_hash=${input.identifierHash} and origin_hash=${input.originHash}
        and request_count > ${input.max} and window_started_at >= ${lookbackStart.toISOString()}
    `);
    const blockedWindows = rows[0]?.blocked_windows ?? 0;
    if (blockedWindows < BLOCKED_WINDOW_THRESHOLD) return;

    const cooldownWindowStartedAt = new Date(Math.floor(now.getTime() / ALERT_COOLDOWN_MS) * ALERT_COOLDOWN_MS);
    const dedupeKey = digest(
      `rate-limit-correlation-alert:${input.purpose}:${input.identifierHash}:${input.originHash}:${cooldownWindowStartedAt.toISOString()}`,
    );

    const html = renderTransactionalEmail({
      bodyHtml: `<p>The <b>${escapeHtml(input.purpose)}</b> rate limit has been exceeded in <b>${blockedWindows}</b> of the last ${LOOKBACK_WINDOWS} 15-minute windows for the same account or request origin.</p>
<p>This pattern -- repeated blocking rather than a single blocked request -- is consistent with a sustained credential-stuffing or brute-force attempt, not an ordinary user mistake. The rate limiter itself already rejected every one of these requests; no account was compromised by this activity alone.</p>
<p>Review recent activity for this purpose in <code>idoc.account_request_limits</code> and, if this looks like an active attack, consider the incident-response steps in docs/07 §11.</p>`,
      footerNote: 'IDOC security monitoring. This message never contains a raw email address or IP address, only their existing one-way digests.',
      heading: 'Repeated rate-limit exceedance',
    });
    await enqueueOperationalAlert({
      bodyHtml: html,
      dedupeKey,
      kind: 'rate_limit_correlation_alert',
      subject: taggedSubject('auth.repeated_rate_limit_exceeded', `IDOC: repeated rate-limit exceedance (${input.purpose})`),
    });
  } catch {
    await logWarn('rate_limit_correlation_alert_failed');
  }
}
