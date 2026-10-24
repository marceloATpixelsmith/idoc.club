import { headers } from 'next/headers';
import { rawCanonicalUserId } from '@/lib/auth/session';
import { notifyTechnicalError, pathWithoutQuery } from '@/lib/notifications/admin-event-alerts';
import { currentRequestId } from '@/lib/observability/request-id';

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
  try {
    const requestHeaders = await headers();
    const userId = await rawCanonicalUserId();
    await notifyTechnicalError({
      context: [['Note', 'Reported by the browser error screen. If a server error caused it, a separate email with the stack trace is sent from the server.']],
      path: pathWithoutQuery(requestHeaders.get('referer')), requestId, source: 'browser', user: userId ? { id: userId } : null,
      userAgent: requestHeaders.get('user-agent'),
    });
  } catch {
    // Reporting must still return the correlation reference.
  }
  return Response.json({ requestId }, { headers: { 'Cache-Control': 'no-store' } });
}
