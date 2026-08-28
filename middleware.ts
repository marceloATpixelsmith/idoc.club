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

const protectedRoutes = '/dashboard';

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
  if (isPossibleServerActionRequest(request) && request.headers.get('origin') === null) {
    return new NextResponse('Invalid Server Actions request.', { status: 403 });
  }

  const { pathname } = request.nextUrl;
  const canonicalName = sessionCookieName();
  const canonicalCookie = request.cookies.get(canonicalName);
  const legacyCookie = request.cookies.get(LEGACY_SESSION_COOKIE_NAME);
  const sessionCookie = canonicalCookie ?? legacyCookie;
  const isProtectedRoute = pathname.startsWith(protectedRoutes);

  if (isProtectedRoute && !sessionCookie) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }

  if (!sessionCookie) return NextResponse.next();

  try {
    const parsed = await verifyToken(sessionCookie.value);
    const res = NextResponse.next();

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
      : NextResponse.next();
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
