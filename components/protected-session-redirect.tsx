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
 *
 * Real user activity (clicks, typing), however, does keep the session alive: pages driven mostly by
 * Server Actions or long forms make no GET navigations, so without this an actively working
 * administrator would hit the 30-minute idle limit. A throttled check on genuine input never fires
 * while nobody is at the keyboard, so an abandoned page still expires.
 */
const ACTIVITY_KEEPALIVE_MS = 5 * 60 * 1000;

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
        //
        // Go through the session-expired route, which remembers this page before sending the browser
        // to /sign-in, so signing back in returns here. A reload would not work for a revoked session
        // whose token is still fresh: middleware lets it through and the page redirects on its own.
        const here = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/api/auth/session-expired?returnTo=${encodeURIComponent(here)}`);
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

    let lastActivityCheck = Date.now();
    const onActivity = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastActivityCheck < ACTIVITY_KEEPALIVE_MS) return;
      lastActivityCheck = now;
      void checkSession();
    };

    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [checkSession, initiallySignedIn, pathname]);

  return null;
}
