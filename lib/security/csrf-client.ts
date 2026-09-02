// Client-safe: deliberately has NO 'server-only' import, unlike lib/security/csrf-tokens.ts (which
// cannot be imported from client code at all). The two cookie-name constants below are mirrored
// from that module -- tests/csrf-client-cookie-name.test.ts asserts they never drift apart.
//
// This file exists only to let a same-origin, JS-invoked Server Action that has no <form>/hidden
// field of its own (e.g. signOut()) read the deliberately non-httpOnly CSRF cookie and pass its
// value along explicitly. It never derives, signs, or validates the token -- only the server does
// that (lib/security/csrf.ts, lib/security/csrf-tokens.ts) -- so trusting this file's output is no
// different from trusting any other client-supplied request value.

export const PRODUCTION_CSRF_COOKIE_NAME = '__Host-idoc-csrf';
export const DEVELOPMENT_CSRF_COOKIE_NAME = 'idoc-csrf';

export function csrfCookieNameForClient(nodeEnv: string | undefined = process.env.NODE_ENV): string {
  return nodeEnv === 'production' ? PRODUCTION_CSRF_COOKIE_NAME : DEVELOPMENT_CSRF_COOKIE_NAME;
}

/** Reads the current CSRF token straight from document.cookie. Returns '' outside a browser (SSR)
 * or before middleware has ever set the cookie -- callers should treat an empty value as "no valid
 * evidence," exactly like a missing form field, since the server-side check rejects it the same way. */
export function readCsrfTokenFromDocumentCookie(): string {
  if (typeof document === 'undefined') return '';
  const prefix = `${csrfCookieNameForClient()}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return '';
}
