import 'server-only';

import { escapeHtml, renderTransactionalEmail } from './email-template.ts';
import { sendTransactionalEmail } from './brevo-transactional.ts';
import { taggedSubject } from './alert-severity.ts';
import { logWarn } from '@/lib/observability/logger.ts';
import { currentRequestId } from '@/lib/observability/request-id.ts';
import { checkOriginRateLimit, requestOrigin } from '@/lib/security/rate-limit.ts';

const ALERT_DELIVERY_TIMEOUT_MS = 5_000;

async function deliverAlert(input: { reason: string; step: 'start' | 'callback' }, to: string): Promise<void> {
  const origin = await requestOrigin();
  if (!(await checkOriginRateLimit('google_oauth_failure_alert', origin))) {
    await logWarn('google_oauth_failure_alert_rate_limited');
    return;
  }
  const requestId = await currentRequestId();
  const html = renderTransactionalEmail({
    bodyHtml: `<p>A Google sign-in attempt failed during the <b>${escapeHtml(input.step)}</b> step.</p>
<p>Reason code: <code>${escapeHtml(input.reason)}</code><br/>Correlation ID: <code>${escapeHtml(requestId)}</code></p>
<p>Search your Vercel function logs for this correlation ID for full detail. If this is the first report right after configuring Google Sign-In, first double-check the <code>GOOGLE_OAUTH_*</code> environment variables and the Authorized redirect URI in Google Cloud Console. If Google sign-in was already working and this appears unexpectedly, treat it as a live incident.</p>`,
    footerNote: 'IDOC security monitoring. This message never contains any OAuth code, state, cookie, or token value.',
    heading: 'Google sign-in failure',
  });
  await sendTransactionalEmail(
    { html, subject: taggedSubject('auth.google_oauth_failure', `IDOC: Google sign-in failed (${input.reason})`), to },
    { signal: AbortSignal.timeout(ALERT_DELIVERY_TIMEOUT_MS) },
  );
}

/** Bounds the *whole* operation to `ms`, not just whichever step happens to accept an AbortSignal:
 * `checkOriginRateLimit` is a real database write with no cancellation hook of its own (unlike
 * `fetch`), so a slow/unavailable Postgres could otherwise hold the caller open well past the
 * Brevo-specific timeout on `sendTransactionalEmail` alone. `Promise.race` can't cancel the
 * underlying database query, but it does let the caller stop waiting and continue -- which is what
 * actually matters here: never blocking the OAuth handler's own failure redirect. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('google_oauth_failure_alert_timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort operational alert only: never blocks or changes the caller's own redirect back to the
 * user, and never includes a raw exception message, the OAuth `code`/`state`, or any cookie/token
 * value -- only the categorical failure reason already computed by the caller (see
 * `GoogleOidcError.code` in google-oidc-reference.ts and the callers of this function) plus the
 * request's correlation ID, so an operator can jump straight to the matching Vercel function-log
 * lines. Routed to the existing operations recipient documented in docs/07 §15
 * (`IDOC_ADMIN_NOTIFICATION_EMAIL`) rather than a new dedicated env var. Skips (rather than throws)
 * when unconfigured, matching the established precedent in breached-password-alert.ts.
 *
 * Rate-limited by origin (`google_oauth_failure_alert`, the same `checkOriginRateLimit` primitive
 * `start/route.ts` already uses): `/api/auth/google/callback` is a public, unauthenticated GET route
 * with no rate limit of its own, so without this an anonymous caller could repeatedly hit it with no
 * state/binding cookie and force an email send on every single request -- flooding the paid mail
 * sender and the operations mailbox, and burying genuine alerts under attacker-triggered noise. Every
 * failure is still logged unconditionally by the caller regardless of this limit; only the *email*
 * is throttled.
 *
 * The entire preflight-and-delivery operation is bounded to `ALERT_DELIVERY_TIMEOUT_MS` via
 * `withDeadline` -- not only the Brevo `fetch` -- so a slow rate-limit database query can never
 * hold the caller's own failure redirect open any longer than a slow/unresponsive Brevo could. */
export async function notifyWebmasterOfGoogleOauthFailure(input: { reason: string; step: 'start' | 'callback' }): Promise<void> {
  const to = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    await logWarn('google_oauth_failure_alert_skipped');
    return;
  }
  try {
    await withDeadline(deliverAlert(input, to), ALERT_DELIVERY_TIMEOUT_MS);
  } catch {
    await logWarn('google_oauth_failure_alert_failed');
  }
}
