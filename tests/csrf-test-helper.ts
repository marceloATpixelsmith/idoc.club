import { withTestRequestCookies, type MutableCookieStore } from '../lib/auth/request-cookies.ts';
import { issueCsrfToken } from '../lib/security/csrf.ts';

/** Mints a real, production-issued CSRF token bound to the given session id (or null while
 * anonymous) into `cookies` (via lib/security/csrf.ts's actual issuance function, not a
 * hand-crafted token) and returns the token value to also attach to FormData as csrf_token --
 * every Server Action now requires this, matching what middleware.ts and setSession()/
 * clearSession() do for a real request. */
export async function issueTestCsrfToken(cookies: MutableCookieStore, sessionId: string | null): Promise<string> {
  return withTestRequestCookies(cookies, () => issueCsrfToken(sessionId));
}

/** Sets csrf_token on the given FormData and returns it, for inline chaining at call sites. */
export function withCsrf(formData: FormData, token: string): FormData {
  formData.set('csrf_token', token);
  return formData;
}
