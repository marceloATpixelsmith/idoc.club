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

export async function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID();
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
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs'
};
