/**
 * Pure helpers for the post-sign-in "return to where you were" cookie. No Next.js request-scoped
 * dependency so middleware.ts and unit tests can both import it directly.
 *
 * Only same-origin paths under the protected page families are ever remembered, so the cookie can
 * never be turned into an open redirect or used to land a user on an API/auth route.
 */
export const RETURN_TO_COOKIE_NAME = 'idoc_return_to';
export const RETURN_TO_MAX_AGE_SECONDS = 60 * 60;

const PROTECTED_ROOTS = ['/dashboard', '/admin', '/onboarding'] as const;
const MAX_LENGTH = 512;

/** Returns a normalized `path?query` when `value` is a safe protected-page path, otherwise null. */
export function safeProtectedReturnTo(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, 'https://return-to.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://return-to.invalid') return null;
  const inProtectedFamily = PROTECTED_ROOTS.some(
    (root) => url.pathname === root || url.pathname.startsWith(`${root}/`),
  );
  return inProtectedFamily ? `${url.pathname}${url.search}` : null;
}

/** The location to remember for a request, dropping Next's internal `_rsc` navigation parameter. */
export function returnToFromRequestUrl(url: URL): string | null {
  const search = new URLSearchParams(url.search);
  search.delete('_rsc');
  const query = search.toString();
  return safeProtectedReturnTo(`${url.pathname}${query ? `?${query}` : ''}`);
}

export function returnToCookieOptions(environment: Partial<Record<string, string | undefined>> = process.env) {
  return {
    httpOnly: true,
    maxAge: RETURN_TO_MAX_AGE_SECONDS,
    path: '/' as const,
    sameSite: 'lax' as const,
    secure: environment.NODE_ENV === 'production',
  };
}
