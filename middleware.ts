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

export async function middleware(request: NextRequest) {
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
