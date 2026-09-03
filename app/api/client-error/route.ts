import { logError } from '@/lib/observability/logger';

// Accepts a best-effort crash report from a client error boundary and logs it server-side, so a
// production error is visible in runtime logs even when nobody was watching the browser that hit
// it. No authorization boundary: the whole point is that it must work for anonymous visitors and
// for sessions broken badly enough that authenticated calls themselves might fail. Never touches
// the database or any privileged data — logging only.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body && typeof body === 'object') {
    // Client-controlled error text, stacks, URLs, and digests can contain credentials or personal
    // data. Record only the registered occurrence; request correlation is added by the logger.
    await logError('client_error');
  }
  return new Response(null, { status: 204 });
}
