import { currentRequestId } from '@/lib/observability/request-id';

// Accepts a best-effort crash report from a client error boundary and logs it server-side, so a
// browser error can carry a server-generated correlation reference without sending its diagnostics
// through this endpoint. No authorization boundary: the whole point is that it must work for anonymous visitors and
// for sessions broken badly enough that authenticated calls themselves might fail. Never touches
// the database or any privileged data — logging only.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body && typeof body === 'object') {
    // Client-controlled error text, stacks, URLs, and digests can contain credentials or personal
    // data. The browser exception itself is captured directly by reportClientError(); this endpoint
    // exists only to mint the server-side request/correlation reference used on that Sentry event.
  }
  const requestId = await currentRequestId();
  return Response.json({ requestId }, { headers: { 'Cache-Control': 'no-store' } });
}
