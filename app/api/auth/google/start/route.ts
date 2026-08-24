import { NextRequest, NextResponse } from 'next/server';
import {
  createGoogleAuthorizationRequest,
  loadGoogleOidcConfig,
} from '@/lib/auth/google-oidc-reference';
import { googleOidcTransactionStore } from '@/lib/auth/google-oidc-store';

const APPLICATION_ID = 'idoc.club';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
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

    return NextResponse.redirect(authorization.authorizationUrl, 302);
  } catch {
    return NextResponse.redirect(new URL('/sign-in?google=failed', request.url), 302);
  }
}
