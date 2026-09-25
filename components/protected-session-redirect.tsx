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
 * revoked. SWR already revalidates /api/user on focus/reconnect; on those same browser-resume
 * signals, explicitly revalidate the shared cache and leave the protected page immediately when the
 * authoritative result is null.
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
      const user = await mutate<PublicUser | null>('/api/user');
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
