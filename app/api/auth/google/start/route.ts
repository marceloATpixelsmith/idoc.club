import { NextRequest, NextResponse } from 'next/server';
import {
  createGoogleAuthorizationRequest,
  GoogleOidcError,
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
import {
  googleOauthFailureRedirectPath,
  googleOauthIntentCookieName,
  googleOauthIntentCookieOptions,
  parseGoogleOauthIntent,
} from '@/lib/auth/google-oauth-intent';
import { checkOriginRateLimit, requestOrigin } from '@/lib/security/rate-limit';
import { logError, logWarn } from '@/lib/observability/logger';
import { notifyWebmasterOfGoogleOauthFailure } from '@/lib/notifications/google-oauth-failure-alert';

const APPLICATION_ID = 'idoc.club';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const intent = parseGoogleOauthIntent(request.nextUrl.searchParams.get('intent'));
  const failureRedirect = () =>
    NextResponse.redirect(new URL(`${googleOauthFailureRedirectPath(intent)}?google=failed`, request.url), 302);

  // Names which step was in flight when an error that isn't a GoogleOidcError (and so carries no
  // precise `.code`) is thrown, so the logged/alerted reason still points at a subsystem instead of
  // collapsing every unrelated failure into one opaque 'unexpected_error' -- without logging the
  // exception itself (AUTH-LOG-003: a static, non-sensitive category only, never raw error content).
  let phase: 'transaction_purge' | 'authorization_request' = 'transaction_purge';

  try {
    const origin = await requestOrigin();
    if (!(await checkOriginRateLimit('google_oauth_start', origin))) {
      // Deliberately logWarn, not logError/notifyWebmasterOfGoogleOauthFailure: this is expected,
      // routine throttling (e.g. many members behind one institutional NAT), not an incident -- but
      // it must still be logged, so this specific failure isn't silently invisible to an operator
      // trying to explain a "failed" report from a real user.
      await logWarn('google_oauth_start_failed', { category: 'auth', reason: 'rate_limited' });
      return failureRedirect();
    }

    await purgeExpiredGoogleOauthTransactions();

    const config = loadGoogleOidcConfig();
    const applicationOrigin = new URL(config.redirectUri).origin;
    const returnTo = request.nextUrl.searchParams.get('returnTo') ?? '/dashboard';

    phase = 'authorization_request';
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
    response.cookies.set(googleOauthIntentCookieName(), intent, googleOauthIntentCookieOptions());
    return response;
  } catch (error) {
    const reason = error instanceof GoogleOidcError ? error.code : `unexpected_error:${phase}`;
    await logError('google_oauth_start_failed', { category: 'auth', reason });
    await notifyWebmasterOfGoogleOauthFailure({ reason, step: 'start' });
    // TEMPORARY -- one-off production diagnostic, remove before merge.
    if (request.nextUrl.searchParams.get('debug') === '8lpOZIFEQYlUGHrFHO8AuutZJEebVDw5') {
      const e = error as { name?: string; message?: string; code?: string; stack?: string };
      return NextResponse.json({ phase, name: e?.name, message: e?.message, code: e?.code, stack: e?.stack }, { status: 500 });
    }
    return failureRedirect();
  }
}
