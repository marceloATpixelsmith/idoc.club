import { NextRequest, NextResponse } from 'next/server';
import {
  completeGoogleOidcCallback,
  loadGoogleOidcConfig,
} from '@/lib/auth/google-oidc-reference';
import { googleOidcTransactionStore } from '@/lib/auth/google-oidc-store';
import {
  expiredGoogleOauthBindingCookieOptions,
  googleOauthBindingCookieName,
  verifyGoogleOauthBrowserBinding,
} from '@/lib/auth/google-oauth-browser-binding';
import {
  authenticateGoogleIdentity,
  GoogleAccountLinkRequiredError,
} from '@/lib/auth/google-account';
import { getUser } from '@/lib/db/queries';
import {
  clearGoogleLinkFreshEvidence,
  readGoogleLinkFreshEvidence,
} from '@/lib/auth/google-identity-link-evidence';
import { linkGoogleIdentity } from '@/lib/auth/google-identity-linking';

const APPLICATION_ID = 'idoc.club';
export const runtime = 'nodejs';

function clearBinding(response: NextResponse) {
  response.cookies.set(googleOauthBindingCookieName(), '', expiredGoogleOauthBindingCookieOptions());
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const state = request.nextUrl.searchParams.get('state');
    const binding = request.cookies.get(googleOauthBindingCookieName())?.value;
    if (!state || !verifyGoogleOauthBrowserBinding(binding, state)) {
      return clearBinding(NextResponse.redirect(new URL('/sign-in?google=failed', request.url), 302));
    }

    const config = loadGoogleOidcConfig();
    const applicationOrigin = new URL(config.redirectUri).origin;
    const identity = await completeGoogleOidcCallback({
      applicationId: APPLICATION_ID,
      applicationOrigin,
      code: request.nextUrl.searchParams.get('code'),
      state,
      providerError: request.nextUrl.searchParams.get('error'),
      config,
      store: googleOidcTransactionStore,
    });

    if (identity.oauthTransactionPurpose === 'external_identity_link') {
      const user = await getUser();
      if (!user || identity.oauthAuthenticatedUserId !== String(user.id)) throw new Error('Invalid Google link subject binding.');
      const evidence = await readGoogleLinkFreshEvidence(user.id);
      if (!evidence) throw new Error('Fresh verification is required for Google linking.');
      const result = await linkGoogleIdentity({ userId: String(user.id), identity, freshEvidence: evidence });
      await clearGoogleLinkFreshEvidence();
      const value = result.status === 'linked' || result.status === 'already-linked' ? 'linked' : result.status;
      return clearBinding(NextResponse.redirect(new URL(`/dashboard/security?google=${value}`, applicationOrigin), 302));
    }

    const authenticated = await authenticateGoogleIdentity(identity);
    return clearBinding(NextResponse.redirect(new URL(authenticated.redirectTo, applicationOrigin), 302));
  } catch (error) {
    await clearGoogleLinkFreshEvidence();
    const user = await getUser().catch(() => null);
    if (user) return clearBinding(NextResponse.redirect(new URL('/dashboard/security?google=failed', request.url), 302));
    const reason = error instanceof GoogleAccountLinkRequiredError ? 'link-required' : 'failed';
    return clearBinding(NextResponse.redirect(new URL(`/sign-in?google=${reason}`, request.url), 302));
  }
}
