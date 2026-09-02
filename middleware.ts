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
import { csrfCookieName, csrfCookieOptions, signCsrfToken, verifyCsrfToken } from '@/lib/security/csrf-tokens';

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

  const { pathname } = request.nextUrl;
  const canonicalName = sessionCookieName();
  const canonicalCookie = request.cookies.get(canonicalName);
  // A signed JWT alone is never sufficient authentication authority: only the canonical cookie
  // (verified above, and registry-checked by every downstream getSession() call) may establish
  // access to a protected route. The legacy pre-retrofit cookie is never read for authentication
  // here -- it is only ever defensively cleared, on every response path below, in case a browser
  // still holds one from before the persisted-session-registry retrofit.
  const legacyCookie = request.cookies.get(LEGACY_SESSION_COOKIE_NAME);
  const isProtectedRoute = pathname.startsWith(protectedRoutes);

  // AUTH-CSRF-003: ensure a valid, correctly session-bound CSRF cookie exists before this request
  // reaches any Server Component render or Server Action. A token minted anonymously (or under a
  // different session) is replaced once the real current session is known, so a stale/foreign token
  // is never carried forward. Mutating request.cookies -- not only the outgoing response -- before
  // building the forwarded request is what makes a freshly-minted token visible to *this same*
  // request's page render (the hidden form field on a visitor's very first page load), not only a
  // later one; middleware has no next/headers, so this calls the pure csrf-tokens.ts functions
  // directly rather than lib/security/csrf.ts's request-scoped wrappers.
  let sessionIdForCsrf: string | null = null;
  if (canonicalCookie) {
    try { sessionIdForCsrf = (await verifyToken(canonicalCookie.value)).sessionId; } catch { /* handled below */ }
  }
  const existingCsrfCookie = request.cookies.get(csrfCookieName());
  const existingCsrfPayload = existingCsrfCookie ? await verifyCsrfToken(existingCsrfCookie.value) : null;
  let mintedCsrfToken: string | null = null;
  if (!existingCsrfPayload || existingCsrfPayload.sessionRef !== sessionIdForCsrf) {
    mintedCsrfToken = await signCsrfToken(sessionIdForCsrf);
    request.cookies.set(csrfCookieName(), mintedCsrfToken);
  }
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);
  const next = () => NextResponse.next({ request: { headers: forwardedHeaders } });

  const finish = (res: NextResponse) => {
    res.headers.set(REQUEST_ID_HEADER, requestId);
    if (legacyCookie) res.cookies.delete(LEGACY_SESSION_COOKIE_NAME);
    if (mintedCsrfToken) res.cookies.set({ name: csrfCookieName(), value: mintedCsrfToken, ...csrfCookieOptions() });
    return res;
  };

  if (isProtectedRoute && !canonicalCookie) {
    return finish(NextResponse.redirect(new URL('/sign-in', request.url)));
  }

  if (!canonicalCookie) {
    return finish(next());
  }

  try {
    const parsed = await verifyToken(canonicalCookie.value);
    const res = next();

    if (request.method === 'GET') {
      const refreshed = refreshSessionActivity(parsed);
      res.cookies.set({
        name: canonicalName,
        value: await signToken(refreshed),
        ...sessionCookieOptions(refreshed.absoluteExpiresAt),
      });
    }

    return finish(res);
  } catch {
    const res = isProtectedRoute
      ? NextResponse.redirect(new URL('/sign-in', request.url))
      : next();
    res.cookies.set({ name: canonicalName, value: '', ...expiredSessionCookieOptions() });
    return finish(res);
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs'
};
