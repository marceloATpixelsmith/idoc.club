'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useSWRConfig } from 'swr';
import type { PublicUser } from '@/lib/db/queries';

const PROTECTED_ROOTS = ['/dashboard', '/admin', '/onboarding'] as const;

function isProtectedPath(pathname: string) {
  return PROTECTED_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/**
 * Server-rendered protected pages already fail closed on the initial request. This client guard
 * covers the different case where a valid page stays open after its session later expires or is
 * revoked. On the same browser-resume signals SWR itself revalidates on, fetch /api/user directly
 * and leave the protected page immediately when the authoritative result is null.
 *
 * Deliberately fetches directly rather than calling the bound `mutate('/api/user')` with no data:
 * that form only revalidates through whatever fetcher some other currently-mounted `useSWR('/api/user',
 * ...)` hook happens to have registered at that exact moment (e.g. AuthenticatedUserMenu, rendered
 * twice for the desktop/mobile header). Whether that registration is live is a timing race this
 * component doesn't control, and losing it resolves to `undefined` -- not `null` -- silently skipping
 * the redirect below. Fetching here directly and pushing the result into the shared cache with
 * `{ revalidate: false }` keeps the header UI in sync without depending on that race.
 *
 * Deliberately no interval/polling: authenticated GETs refresh the session idle timer in middleware,
 * so background polling would keep an otherwise-idle session alive indefinitely.
 */
export function ProtectedSessionRedirect({ initiallySignedIn }: { initiallySignedIn: boolean }) {
  const pathname = usePathname();
  const { mutate } = useSWRConfig();
  const checking = useRef(false);

  const checkSession = useCallback(async () => {
    if (!initiallySignedIn || !isProtectedPath(pathname) || checking.current) return;

    checking.current = true;
    try {
      const response = await fetch('/api/user', { cache: 'no-store' });
      const user: PublicUser | null = response.ok ? await response.json() : null;
      await mutate('/api/user', user, { revalidate: false });
      if (user === null && isProtectedPath(window.location.pathname)) {
        // The async revalidation may finish after the user already navigated out of this layout.
        // Only redirect while the browser is still on a protected route, otherwise a slow null
        // response could incorrectly pull an already-public page back to sign-in.
        //
        // Hard replacement removes the stale protected page from browser history and guarantees the
        // next render starts at the server-authenticated sign-in boundary.
        window.location.replace('/sign-in');
      }
    } finally {
      checking.current = false;
    }
  }, [initiallySignedIn, mutate, pathname]);

  useEffect(() => {
    if (!initiallySignedIn || !isProtectedPath(pathname)) return;

    const onFocus = () => void checkSession();
    const onOnline = () => void checkSession();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkSession();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void checkSession();
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [checkSession, initiallySignedIn, pathname]);

  return null;
}
