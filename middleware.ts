import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  expiredSessionCookieOptions,
  LEGACY_SESSION_COOKIE_NAME,
  refreshSessionActivity,
  sessionCookieName,
  sessionCookieOptions,
  signToken,
  verifyToken,
} from '@/lib/auth/session';
import { REQUEST_ID_HEADER } from '@/lib/observability/request-id-header';

const protectedRoutes = '/dashboard';

// A lightweight substitute for a full APM/tracing vendor integration (docs/21 AUTH-LOG-004): every
// request is assigned a fresh correlation ID here, before any application code runs, so a single
// request's log lines can be tied together by grepping one ID. Always generated server-side --
// never taken from an inbound header -- so a client cannot inject an arbitrary value into correlated
// log output. Forwarded as a request header so Server Components/Actions/Route Handlers can read it
// via `next/headers` (see `lib/observability/request-id.ts`), and also set as a response header so a
// user or support agent can hand back the exact ID from their browser's network tab.

// Next.js's built-in Server Action CSRF defense (action-handler.ts) rejects a POST whose `Origin`
// header is present but does not match the deployment's own host -- but explicitly *lets through* a
// request that omits `Origin` entirely (treating it like an old browser that never sent one). A real
// browser reliably sends `Origin` on every cross-site POST, fetch-based or plain-form, so this is a
// narrow gap rather than an open door, but it is a documented one (docs/21 AUTH-CSRF-001) worth
// closing outright rather than leaving as residual risk. Detection here intentionally mirrors Next's
// own `getServerActionRequestMetadata` (next/dist/server/lib/server-action-request-meta.js) exactly,
// so this check fires on precisely the same requests Next itself treats as a possible Server Action --
// no broader, no narrower -- covering both JS fetch-based actions (the `next-action` header) and the
// progressive-enhancement plain-<form> case (url-encoded/multipart POST bodies).
function isPossibleServerActionRequest(request: NextRequest): boolean {
  if (request.method !== 'POST') return false;
  if (request.headers.get('next-action') !== null) return true;
  const contentType = request.headers.get('content-type');
  return contentType === 'application/x-www-form-urlencoded' || (contentType?.startsWith('multipart/form-data') ?? false);
}

export async function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID();

  if (isPossibleServerActionRequest(request) && request.headers.get('origin') === null) {
    const res = new NextResponse('Invalid Server Actions request.', { status: 403 });
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);
  const next = () => NextResponse.next({ request: { headers: forwardedHeaders } });

  const { pathname } = request.nextUrl;
  const canonicalName = sessionCookieName();
  const canonicalCookie = request.cookies.get(canonicalName);
  const legacyCookie = request.cookies.get(LEGACY_SESSION_COOKIE_NAME);
  const sessionCookie = canonicalCookie ?? legacyCookie;
  const isProtectedRoute = pathname.startsWith(protectedRoutes);

  if (isProtectedRoute && !sessionCookie) {
    const res = NextResponse.redirect(new URL('/sign-in', request.url));
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  if (!sessionCookie) {
    const res = next();
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  try {
    const parsed = await verifyToken(sessionCookie.value);
    const res = next();
    res.headers.set(REQUEST_ID_HEADER, requestId);

    // Only already-canonical sessions may be refreshed. A legacy JWT has no persisted registry
    // row, so silently promoting it into the canonical cookie namespace would create a bearer
    // token that the authoritative server registry cannot revoke. Legacy sessions simply age out
    // under the fixed 12-hour cap or are replaced on the next successful login.
    if (request.method === 'GET' && canonicalCookie) {
      const refreshed = refreshSessionActivity(parsed);
      res.cookies.set({
        name: canonicalName,
        value: await signToken(refreshed),
        ...sessionCookieOptions(refreshed.absoluteExpiresAt),
      });
    }

    return res;
  } catch {
    const res = isProtectedRoute
      ? NextResponse.redirect(new URL('/sign-in', request.url))
      : next();
    res.headers.set(REQUEST_ID_HEADER, requestId);
    if (canonicalCookie) {
      res.cookies.set({ name: canonicalName, value: '', ...expiredSessionCookieOptions() });
    }
    if (legacyCookie) res.cookies.delete(LEGACY_SESSION_COOKIE_NAME);
    return res;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs'
};
