import 'server-only';

import { escapeHtml, renderTransactionalEmail } from './email-template.ts';
import { sendTransactionalEmail } from './mailchimp-transactional.ts';
import { logWarn } from '@/lib/observability/logger.ts';
import { currentRequestId } from '@/lib/observability/request-id.ts';

/** Best-effort operational alert only: never blocks or changes the caller's own redirect back to the
 * user, and never includes a raw exception message, the OAuth `code`/`state`, or any cookie/token
 * value -- only the categorical failure reason already computed by the caller (see
 * `GoogleOidcError.code` in google-oidc-reference.ts and the callers of this function) plus the
 * request's correlation ID, so an operator can jump straight to the matching Vercel function-log
 * lines. Routed to the existing operations recipient documented in docs/07 §15
 * (`IDOC_ADMIN_NOTIFICATION_EMAIL`) rather than a new dedicated env var. Skips (rather than throws)
 * when unconfigured, matching the established precedent in breached-password-alert.ts. Deliberately
 * has no dedup/rate-limit of its own: Google sign-in failures are rare in a correctly configured
 * production deployment, so the natural volume is low; during initial setup, seeing one alert per
 * failed attempt is exactly the debugging signal this exists to provide. */
export async function notifyWebmasterOfGoogleOauthFailure(input: { reason: string; step: 'start' | 'callback' }): Promise<void> {
  const to = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    await logWarn('google_oauth_failure_alert_skipped', { category: 'configuration' });
    return;
  }
  try {
    const requestId = await currentRequestId();
    const html = renderTransactionalEmail({
      bodyHtml: `<p>A Google sign-in attempt failed during the <b>${escapeHtml(input.step)}</b> step.</p>
<p>Reason code: <code>${escapeHtml(input.reason)}</code><br/>Correlation ID: <code>${escapeHtml(requestId)}</code></p>
<p>Search your Vercel function logs for this correlation ID for full detail. If this is the first report right after configuring Google Sign-In, first double-check the <code>GOOGLE_OAUTH_*</code> environment variables and the Authorized redirect URI in Google Cloud Console. If Google sign-in was already working and this appears unexpectedly, treat it as a live incident.</p>`,
      footerNote: 'IDOC security monitoring. This message never contains any OAuth code, state, cookie, or token value.',
      heading: 'Google sign-in failure',
    });
    await sendTransactionalEmail({ html, subject: `IDOC: Google sign-in failed (${input.reason})`, to });
  } catch {
    await logWarn('google_oauth_failure_alert_failed', { category: 'delivery' });
  }
}
