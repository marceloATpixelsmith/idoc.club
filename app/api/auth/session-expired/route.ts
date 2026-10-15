import { NextRequest, NextResponse } from 'next/server';
import { RETURN_TO_COOKIE_NAME, returnToCookieOptions, safeProtectedReturnTo } from '@/lib/auth/return-to-path';

// Landing point for the client-side expired/revoked-session guard. A revoked session whose token is
// still cryptographically fresh is not caught by middleware, so the page cannot rely on a reload to
// be bounced through middleware's own sign-in redirect; this route remembers the page being left
// (validated to a protected same-origin path, exactly as middleware does) and sends the browser to
// sign-in. No data access and no authority: the cookie can only ever influence where a later,
// successful sign-in lands, and it is validated again when consumed.
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/sign-in', request.url), 303);
  const returnTo = safeProtectedReturnTo(request.nextUrl.searchParams.get('returnTo'));
  if (returnTo) response.cookies.set({ name: RETURN_TO_COOKIE_NAME, value: returnTo, ...returnToCookieOptions() });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
