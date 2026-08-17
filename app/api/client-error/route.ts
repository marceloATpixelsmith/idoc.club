const MAX_FIELD_LENGTH = 2000;

function truncate(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_FIELD_LENGTH) : '';
}

// Accepts a best-effort crash report from a client error boundary and logs it server-side, so a
// production error is visible in runtime logs even when nobody was watching the browser that hit
// it. No authorization boundary: the whole point is that it must work for anonymous visitors and
// for sessions broken badly enough that authenticated calls themselves might fail. Never touches
// the database or any privileged data — logging only.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body && typeof body === 'object') {
    console.error('[client-error]', {
      digest: truncate((body as Record<string, unknown>).digest),
      message: truncate((body as Record<string, unknown>).message),
      stack: truncate((body as Record<string, unknown>).stack),
      url: truncate((body as Record<string, unknown>).url),
    });
  }
  return new Response(null, { status: 204 });
}
