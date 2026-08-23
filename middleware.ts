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

    if (request.method === 'GET') {
      const refreshed = refreshSessionActivity(parsed);
      res.cookies.set({
        name: canonicalName,
        value: await signToken(refreshed),
        ...sessionCookieOptions(refreshed.absoluteExpiresAt),
      });
      if (legacyCookie) res.cookies.delete(LEGACY_SESSION_COOKIE_NAME);
    }

    return res;
  } catch {
    const res = isProtectedRoute
      ? NextResponse.redirect(new URL('/sign-in', request.url))
      : NextResponse.next();
    res.cookies.set({ name: canonicalName, value: '', ...expiredSessionCookieOptions() });
    res.cookies.delete(LEGACY_SESSION_COOKIE_NAME);
    return res;
  }
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs'
};
