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
  return response;
}

/** Distinguishes an expected, benign outcome (the user's account genuinely isn't linked, or isn't
 * eligible for Google sign-in -- a real business rule, not a bug) from a genuine protocol/config
 * problem worth paging an operator about. `GoogleOidcError.code` already carries a precise category
 * (see google-oidc-reference.ts) for exactly this purpose. */
function classifyGoogleOauthFailure(error: unknown): { alert: boolean; reason: string } {
  if (error instanceof GoogleOidcError) return { alert: true, reason: error.code };
  if (error instanceof GoogleAccountLinkRequiredError) return { alert: false, reason: 'link_required' };
  if (error instanceof GoogleAccountNotEligibleError) return { alert: false, reason: 'account_not_eligible' };
  return { alert: true, reason: 'unexpected_error' };
}

export async function GET(request: NextRequest) {
  try {
    const state = request.nextUrl.searchParams.get('state');
    const binding = request.cookies.get(googleOauthBindingCookieName())?.value;
    if (!state || !verifyGoogleOauthBrowserBinding(binding, state)) {
      await logError('google_oauth_callback_failed', { category: 'auth', reason: 'binding_cookie_invalid' });
      await notifyWebmasterOfGoogleOauthFailure({ reason: 'binding_cookie_invalid', step: 'callback' });
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
    if (await beginPrimaryMfa(authenticated.user, 'google', authenticated.redirectTo)) {
      return clearBinding(NextResponse.redirect(new URL('/mfa', applicationOrigin), 302));
    }
    await setSession(authenticated.user);
    return clearBinding(NextResponse.redirect(new URL(authenticated.redirectTo, applicationOrigin), 302));
  } catch (error) {
    await clearGoogleLinkFreshEvidence();
    const { alert, reason } = classifyGoogleOauthFailure(error);
    await logError('google_oauth_callback_failed', { category: 'auth', reason });
    if (alert) await notifyWebmasterOfGoogleOauthFailure({ reason, step: 'callback' });
    const user = await getUser().catch(() => null);
    if (user) return clearBinding(NextResponse.redirect(new URL('/dashboard/security?google=failed', request.url), 302));
    const redirectReason = error instanceof GoogleAccountLinkRequiredError ? 'link-required' : 'failed';
    return clearBinding(NextResponse.redirect(new URL(`/sign-in?google=${redirectReason}`, request.url), 302));
  }
}
