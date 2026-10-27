import { headers } from 'next/headers';
import { rawCanonicalUserId } from '@/lib/auth/session';
import { deferAdminNotification, notifyTechnicalError, reportedPagePath, reportedUserAgent } from '@/lib/notifications/admin-event-alerts';
import { currentRequestId } from '@/lib/observability/request-id';
import { checkOriginRateLimit, requestOrigin } from '@/lib/security/rate-limit';

// Accepts a best-effort crash report from a client error boundary and logs it server-side, so a
// browser error can carry a server-generated correlation reference without sending its diagnostics
// through this endpoint. No authorization boundary: the whole point is that it must work for anonymous visitors and
// for sessions broken badly enough that authenticated calls themselves might fail. Never touches
// privileged data; the only database access is the best-effort Technical Support notification below.
export async function POST() {
  // The request body is deliberately never read or parsed: client-controlled error text, stacks,
  // URLs, and digests can contain credentials or personal data, and this endpoint is anonymous, so
  // parsing would only add avoidable work. The browser exception itself is captured directly by
  // reportClientError(); this endpoint exists only to mint the server-side request/correlation
  // reference used on that Sentry event.
  const requestId = await currentRequestId();
  // Tell the Technical Support assignees that a visitor hit an error screen. Only server-known facts are used (the page the
  // request came from, the signed-in account, the correlation reference) -- the anonymous request body is still never read.
  // Delivery runs after the response so the correlation reference (and the browser's Sentry report that waits on it) is never delayed.
  try {
    const requestHeaders = await headers();
    // The caller is anonymous and its headers are free text, so both the volume and the text are bounded here. The volume limit is
    // shared through the database (per caller address, and for the whole deployment), because the in-process budget inside
    // notifyTechnicalError is per serverless instance and does not add up across the instances a burst of requests lands on.
    // Over the limit the caller still gets its correlation reference; only the staff email is skipped.
    const allowed = await checkOriginRateLimit('client_error_report', await requestOrigin()) && await checkOriginRateLimit('client_error_report', 'deployment-wide');
    if (allowed) {
      const report = {
        context: [['Note', 'Reported by the browser error screen. If a server error caused it, a separate email with the stack trace is sent from the server.']] as const,
        path: reportedPagePath(requestHeaders.get('referer'), requestHeaders.get('host')), requestId, source: 'browser',
        user: await rawCanonicalUserId().then((id) => (id ? { id } : null)), userAgent: reportedUserAgent(requestHeaders.get('user-agent')),
      };
      deferAdminNotification(() => notifyTechnicalError(report));
    }
  } catch {
    // Reporting must still return the correlation reference.
  }
  return Response.json({ requestId }, { headers: { 'Cache-Control': 'no-store' } });
}
