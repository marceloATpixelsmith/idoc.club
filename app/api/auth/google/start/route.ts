import { NextRequest, NextResponse } from 'next/server';
import {
  createGoogleAuthorizationRequest,
  loadGoogleOidcConfig,
} from '@/lib/auth/google-oidc-reference';
import {
  googleOidcTransactionStore,
  purgeExpiredGoogleOauthTransactions,
} from '@/lib/auth/google-oidc-store';
import {
  createGoogleOauthBrowserBinding,
  googleOauthBindingCookieName,
  googleOauthBindingCookieOptions,
} from '@/lib/auth/google-oauth-browser-binding';
import { checkOriginRateLimit, requestOrigin } from '@/lib/security/rate-limit';

const APPLICATION_ID = 'idoc.club';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const origin = await requestOrigin();
    if (!(await checkOriginRateLimit('google_oauth_start', origin))) {
      return NextResponse.redirect(new URL('/sign-in?google=failed', request.url), 302);
    }

    await purgeExpiredGoogleOauthTransactions();

    const config = loadGoogleOidcConfig();
    const applicationOrigin = new URL(config.redirectUri).origin;
    const returnTo = request.nextUrl.searchParams.get('returnTo') ?? '/dashboard';
    const authorization = await createGoogleAuthorizationRequest({
      applicationId: APPLICATION_ID,
      applicationOrigin,
      config,
      returnTo,
      store: googleOidcTransactionStore,
    });

    const state = new URL(authorization.authorizationUrl).searchParams.get('state');
    if (!state) throw new Error('Google OAuth authorization state was not created.');

    const response = NextResponse.redirect(authorization.authorizationUrl, 302);
    response.cookies.set(
      googleOauthBindingCookieName(),
      createGoogleOauthBrowserBinding(state),
      googleOauthBindingCookieOptions(),
    );
    return response;
  } catch {
    return NextResponse.redirect(new URL('/sign-in?google=failed', request.url), 302);
  }
}
