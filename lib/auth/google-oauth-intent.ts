import 'server-only';

import { GOOGLE_OAUTH_BINDING_TTL_SECONDS } from '@/lib/auth/google-oauth-browser-binding';

/** Which auth page the user started the Google flow from, so an error sends them back to it
 * instead of always landing on sign-in. Not security-relevant -- it only steers a redirect. */
export type GoogleOauthIntent = 'signup' | 'login';

const PRODUCTION_COOKIE = '__Host-idoc-google-oauth-intent';
const DEVELOPMENT_COOKIE = 'idoc-google-oauth-intent';

export function googleOauthIntentCookieName() {
  return process.env.NODE_ENV === 'production' ? PRODUCTION_COOKIE : DEVELOPMENT_COOKIE;
}

export function googleOauthIntentCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: GOOGLE_OAUTH_BINDING_TTL_SECONDS,
  };
}

export function expiredGoogleOauthIntentCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  };
}

export function parseGoogleOauthIntent(value: string | null | undefined): GoogleOauthIntent {
  return value === 'signup' ? 'signup' : 'login';
}

export function googleOauthFailureRedirectPath(intent: GoogleOauthIntent) {
  return intent === 'signup' ? '/sign-up' : '/sign-in';
}
