import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
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
import { readGoogleLinkFreshEvidence } from '@/lib/auth/google-identity-link-evidence';

const APPLICATION_ID = 'idoc.club';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.redirect(new URL('/sign-in', request.url), 302);
    const evidence = await readGoogleLinkFreshEvidence(user.id);
    if (!evidence) return NextResponse.redirect(new URL('/dashboard/security?google=verification-required', request.url), 302);

    await purgeExpiredGoogleOauthTransactions();
    const config = loadGoogleOidcConfig();
    const applicationOrigin = new URL(config.redirectUri).origin;
    const authorization = await createGoogleAuthorizationRequest({
      applicationId: APPLICATION_ID,
      applicationOrigin,
      config,
      returnTo: '/dashboard/security',
      purpose: 'external_identity_link',
      authenticatedUserId: String(user.id),
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
    return NextResponse.redirect(new URL('/dashboard/security?google=failed', request.url), 302);
  }
}
