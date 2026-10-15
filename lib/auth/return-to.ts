import { requestCookies } from '@/lib/auth/request-cookies';
import { RETURN_TO_COOKIE_NAME, safeProtectedReturnTo } from '@/lib/auth/return-to-path';
import 'server-only';

/**
 * Where to send a user who has just finished signing in. If middleware remembered the protected page
 * they were bounced from (expired or missing session), return it; otherwise `fallback`. The cookie is
 * always cleared so it can never apply to a later, unrelated sign-in.
 */
export async function consumeReturnTo(fallback: string): Promise<string> {
  const cookieStore = await requestCookies();
  const remembered = safeProtectedReturnTo(cookieStore.get(RETURN_TO_COOKIE_NAME)?.value);
  if (cookieStore.get(RETURN_TO_COOKIE_NAME)) cookieStore.delete(RETURN_TO_COOKIE_NAME);
  return remembered ?? fallback;
}
