import 'server-only';

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { escapeHtml, renderTransactionalEmail } from './email-template';
import { sendTransactionalEmail } from './mailchimp-transactional';
import { taggedSubject } from './alert-severity';
import { logWarn } from '@/lib/observability/logger';

// AUTH-OPERATIONS-006: correlates repeated rate-limit exceedances of the same auth-security bucket
// across multiple time windows into a single operator alert. A single blocked request is routine
// (rate limiting itself already handled it); the alert-worthy signal is *sustained* blocking of the
// same identity/origin across consecutive windows, which is the actual shape of a live
// credential-stuffing or brute-force attempt rather than an ordinary user mistake. This deliberately
// does not attempt general anomaly detection -- only this one, narrow, real correlation over data
// this codebase already records in idoc.account_request_limits.

const WINDOW_MS = 15 * 60 * 1000; // must match lib/security/rate-limit.ts's own WINDOW_MS
const LOOKBACK_WINDOWS = 4; // the last hour
const BLOCKED_WINDOW_THRESHOLD = 3; // blocked in 3 of the last 4 windows -- sustained, not a blip
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // at most one alert per bucket per hour

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** account_request_limits.purpose is varchar(30) and identifier_hash/origin_hash are varchar(64), so
 * the cooldown marker reuses the *same* already-64-char identifierHash/originHash pair the real
 * bucket used (kept as-is, no further hashing needed) under a distinct, digest-derived purpose
 * namespace -- guaranteed to fit and never collide with a real rate-limited purpose, which are
 * always short, human-readable literals, never a 30-hex-character digest. */
function cooldownWindow(purpose: string, now: Date) {
  return {
    cooldownPurpose: digest(`rate-limit-correlation-alert:${purpose}`).slice(0, 30),
    windowStartedAt: new Date(Math.floor(now.getTime() / ALERT_COOLDOWN_MS) * ALERT_COOLDOWN_MS),
  };
}

/** Read-only: never mutates the cooldown marker. A Codex review on this pull request caught that the
 * original version recorded the marker (via an unconditional insert-or-increment) *before* attempting
 * delivery, so a single transient `sendTransactionalEmail` failure would silently suppress every
 * subsequent alert attempt for the same bucket for the rest of the hour -- losing the correlated
 * attack alert entirely, not merely delaying it. Recording now happens only in recordAlertSent, called
 * only after a successful send (see below). */
async function alreadyAlertedRecently(purpose: string, identifierHash: string, originHash: string, now: Date): Promise<boolean> {
  const { cooldownPurpose, windowStartedAt } = cooldownWindow(purpose, now);
  const rows = await db.execute<{ id: number }>(sql`
    select id from idoc.account_request_limits
    where purpose=${cooldownPurpose} and identifier_hash=${identifierHash} and origin_hash=${originHash}
      and window_started_at=${windowStartedAt.toISOString()}
    limit 1
  `);
  return rows.length > 0;
}

async function recordAlertSent(purpose: string, identifierHash: string, originHash: string, now: Date): Promise<void> {
  const { cooldownPurpose, windowStartedAt } = cooldownWindow(purpose, now);
  await db.execute(sql`
    insert into idoc.account_request_limits (purpose, identifier_hash, origin_hash, window_started_at)
    values (${cooldownPurpose}, ${identifierHash}, ${originHash}, ${windowStartedAt.toISOString()})
    on conflict (purpose, identifier_hash, origin_hash, window_started_at)
    do update set request_count = idoc.account_request_limits.request_count + 1, updated_at = now()
  `);
}

/** Called by checkRateLimit whenever one of its two buckets just denied a request. Best-effort only
 * -- never throws, never changes the caller's own rate-limit decision (which already happened), and
 * never includes the raw email/IP, only their existing HMAC-like digests already used as the bucket
 * key (no new sensitive material is introduced or retained). */
export async function correlateRepeatedRateLimitExceedance(input: {
  identifierHash: string;
  max: number;
  now?: Date;
  originHash: string;
  purpose: string;
}): Promise<void> {
  const to = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
  if (!to) return;
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
    if (await alreadyAlertedRecently(input.purpose, input.identifierHash, input.originHash, now)) return;

    const html = renderTransactionalEmail({
      bodyHtml: `<p>The <b>${escapeHtml(input.purpose)}</b> rate limit has been exceeded in <b>${blockedWindows}</b> of the last ${LOOKBACK_WINDOWS} 15-minute windows for the same account or request origin.</p>
<p>This pattern -- repeated blocking rather than a single blocked request -- is consistent with a sustained credential-stuffing or brute-force attempt, not an ordinary user mistake. The rate limiter itself already rejected every one of these requests; no account was compromised by this activity alone.</p>
<p>Review recent activity for this purpose in <code>idoc.account_request_limits</code> and, if this looks like an active attack, consider the incident-response steps in docs/07 §11.</p>`,
      footerNote: 'IDOC security monitoring. This message never contains a raw email address or IP address, only their existing one-way digests.',
      heading: 'Repeated rate-limit exceedance',
    });
    await sendTransactionalEmail({
      html, to,
      subject: taggedSubject('auth.repeated_rate_limit_exceeded', `IDOC: repeated rate-limit exceedance (${input.purpose})`),
    });
    // Only reached once the send above did not throw -- see recordAlertSent's own comment for why
    // this must never happen before a successful delivery.
    await recordAlertSent(input.purpose, input.identifierHash, input.originHash, now);
  } catch {
    await logWarn('rate_limit_correlation_alert_failed');
  }
}
