import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { authSecretForServer } from '@/lib/runtime/configuration';

export const GOOGLE_OAUTH_BINDING_TTL_SECONDS = 15 * 60;
const PRODUCTION_COOKIE = '__Host-idoc-google-oauth';
const DEVELOPMENT_COOKIE = 'idoc-google-oauth';

export function googleOauthBindingCookieName() {
  return process.env.NODE_ENV === 'production' ? PRODUCTION_COOKIE : DEVELOPMENT_COOKIE;
}

function signature(state: string) {
  return createHmac('sha256', authSecretForServer()).update(`google-oauth:${state}`).digest('base64url');
}

export function createGoogleOauthBrowserBinding(state: string) {
  return `${state}.${signature(state)}`;
}

export function verifyGoogleOauthBrowserBinding(value: string | undefined, expectedState: string) {
  if (!value) return false;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return false;
  const state = value.slice(0, separator);
  const suppliedSignature = value.slice(separator + 1);
  if (state !== expectedState) return false;

  const expectedSignature = signature(state);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function googleOauthBindingCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: GOOGLE_OAUTH_BINDING_TTL_SECONDS,
  };
}

export function expiredGoogleOauthBindingCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  };
}
