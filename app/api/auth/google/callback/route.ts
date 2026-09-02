import { NextRequest, NextResponse } from 'next/server';
import {
  completeGoogleOidcCallback,
  GoogleOidcError,
  loadGoogleOidcConfig,
} from '@/lib/auth/google-oidc-reference';
import { googleOidcTransactionStore } from '@/lib/auth/google-oidc-store';
import {
  expiredGoogleOauthBindingCookieOptions,
  googleOauthBindingCookieName,
  verifyGoogleOauthBrowserBinding,
} from '@/lib/auth/google-oauth-browser-binding';
import {
  expiredGoogleOauthIntentCookieOptions,
  googleOauthFailureRedirectPath,
  googleOauthIntentCookieName,
  parseGoogleOauthIntent,
} from '@/lib/auth/google-oauth-intent';
import {
  authenticateGoogleIdentity,
  GoogleAccountLinkRequiredError,
  GoogleAccountNotEligibleError,
} from '@/lib/auth/google-account';
import { getUser } from '@/lib/db/queries';
import {
  clearGoogleLinkFreshEvidence,
  readGoogleLinkFreshEvidence,
} from '@/lib/auth/google-identity-link-evidence';
import { linkGoogleIdentity } from '@/lib/auth/google-identity-linking';
import { beginPrimaryMfa } from '@/lib/auth/mfa/login';
import { setSession } from '@/lib/auth/session';
import { logError } from '@/lib/observability/logger';
import { notifyWebmasterOfGoogleOauthFailure } from '@/lib/notifications/google-oauth-failure-alert';

const APPLICATION_ID = 'idoc.club';
export const runtime = 'nodejs';

function clearBinding(response: NextResponse) {
  response.cookies.set(googleOauthBindingCookieName(), '', expiredGoogleOauthBindingCookieOptions());
  response.cookies.set(googleOauthIntentCookieName(), '', expiredGoogleOauthIntentCookieOptions());
  return response;
}

/** Distinguishes an expected, benign outcome (the user's account genuinely isn't linked, isn't
 * eligible for Google sign-in, or the user simply declined Google's consent screen -- all real,
 * ordinary outcomes, not bugs) from a genuine protocol/config problem worth paging an operator
 * about. `GoogleOidcError.code` already carries a precise category (see google-oidc-reference.ts)
 * for exactly this purpose, but `completeGoogleOidcCallback` maps every non-empty `error` query
 * parameter -- including the standard OAuth2 `access_denied` Google sends when a user clicks
 * "Cancel" on the consent screen -- to the same `'provider_error'` code, so the raw parameter value
 * (read directly from the callback URL, never trusted for anything security-relevant) is the only
 * way to tell a routine cancellation apart from an actual provider-side failure. */
function classifyGoogleOauthFailure(error: unknown, providerErrorParam: string | null): { alert: boolean; reason: string } {
  if (error instanceof GoogleOidcError) {
    if (error.code === 'provider_error' && providerErrorParam === 'access_denied') return { alert: false, reason: 'user_declined_consent' };
    return { alert: true, reason: error.code };
  }
  if (error instanceof GoogleAccountLinkRequiredError) return { alert: false, reason: 'link_required' };
  if (error instanceof GoogleAccountNotEligibleError) return { alert: false, reason: 'account_not_eligible' };
  return { alert: true, reason: 'unexpected_error' };
}

export async function GET(request: NextRequest) {
  const intent = parseGoogleOauthIntent(request.cookies.get(googleOauthIntentCookieName())?.value);
  try {
    const state = request.nextUrl.searchParams.get('state');
    const binding = request.cookies.get(googleOauthBindingCookieName())?.value;
    if (!state || !verifyGoogleOauthBrowserBinding(binding, state)) {
      await logError('google_oauth_callback_failed', { reason: 'binding_cookie_invalid' });
      await notifyWebmasterOfGoogleOauthFailure({ reason: 'binding_cookie_invalid', step: 'callback' });
      return clearBinding(
        NextResponse.redirect(new URL(`${googleOauthFailureRedirectPath(intent)}?google=failed`, request.url), 302),
      );
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
    if (await beginPrimaryMfa(authenticated.user, 'google', authenticated.redirectTo)) {
      return clearBinding(NextResponse.redirect(new URL('/mfa', applicationOrigin), 302));
    }
    await setSession(authenticated.user);
    return clearBinding(NextResponse.redirect(new URL(authenticated.redirectTo, applicationOrigin), 302));
  } catch (error) {
    await clearGoogleLinkFreshEvidence();
    const { alert, reason } = classifyGoogleOauthFailure(error, request.nextUrl.searchParams.get('error'));
    await logError('google_oauth_callback_failed', { reason });
    if (alert) await notifyWebmasterOfGoogleOauthFailure({ reason, step: 'callback' });
    const user = await getUser().catch(() => null);
    if (user) return clearBinding(NextResponse.redirect(new URL('/dashboard/security?google=failed', request.url), 302));
    if (error instanceof GoogleAccountLinkRequiredError) {
      // The Google identity belongs to an existing password account, so the correct next step is
      // always to sign in with that password -- regardless of whether the user started from
      // sign-up or sign-in.
      return clearBinding(NextResponse.redirect(new URL('/sign-in?google=link-required', request.url), 302));
    }
    return clearBinding(
      NextResponse.redirect(new URL(`${googleOauthFailureRedirectPath(intent)}?google=failed`, request.url), 302),
    );
  }
}
