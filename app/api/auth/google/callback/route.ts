import { NextRequest, NextResponse } from 'next/server';
import {
  completeGoogleOidcCallback,
  loadGoogleOidcConfig,
} from '@/lib/auth/google-oidc-reference';
import { googleOidcTransactionStore } from '@/lib/auth/google-oidc-store';
import {
  authenticateGoogleIdentity,
  GoogleAccountLinkRequiredError,
} from '@/lib/auth/google-account';

const APPLICATION_ID = 'idoc.club';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const config = loadGoogleOidcConfig();
    const applicationOrigin = new URL(config.redirectUri).origin;
    const identity = await completeGoogleOidcCallback({
      applicationId: APPLICATION_ID,
      applicationOrigin,
      code: request.nextUrl.searchParams.get('code'),
      state: request.nextUrl.searchParams.get('state'),
      providerError: request.nextUrl.searchParams.get('error'),
      config,
      store: googleOidcTransactionStore,
    });

    const authenticated = await authenticateGoogleIdentity(identity);
    return NextResponse.redirect(new URL(authenticated.redirectTo, applicationOrigin), 302);
  } catch (error) {
    const reason = error instanceof GoogleAccountLinkRequiredError ? 'link-required' : 'failed';
    return NextResponse.redirect(new URL(`/sign-in?google=${reason}`, request.url), 302);
  }
}
