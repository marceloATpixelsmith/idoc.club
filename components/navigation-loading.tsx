'use client';

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const NavigationLoadingContext = createContext<(() => void) | null>(null);

// If a click never results in a real navigation (already-current page, a link that opens a
// dialog, etc.) the overlay must not get stuck open forever.
const SAFETY_TIMEOUT_MS = 4000;

function isModifiedClick(event: MouseEvent) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function findAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest('a') : null;
}

// Isolated behind its own Suspense boundary (the pattern Next.js requires for useSearchParams)
// so the root layout's children are never themselves wrapped in Suspense.
function RouteChangeListener({ onRouteChange }: { onRouteChange: (key: string) => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    onRouteChange(`${pathname}?${searchParams.toString()}`);
  }, [pathname, searchParams, onRouteChange]);

  return null;
}

export function NavigationLoadingProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeKeyRef = useRef<string | null>(null);

  const clearSafetyTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    setLoading(true);
    clearSafetyTimeout();
    timeoutRef.current = setTimeout(() => setLoading(false), SAFETY_TIMEOUT_MS);
  }, [clearSafetyTimeout]);

  const handleRouteChange = useCallback(
    (key: string) => {
      if (routeKeyRef.current !== null && routeKeyRef.current !== key) {
        setLoading(false);
        clearSafetyTimeout();
      }
      routeKeyRef.current = key;
    },
    [clearSafetyTimeout]
  );

  useEffect(() => clearSafetyTimeout, [clearSafetyTimeout]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (isModifiedClick(event)) return;
      const anchor = findAnchor(event.target);
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      start();
    }

    // GET forms cause a real browser navigation just like a link. POST/Server Action forms
    // already have their own per-button pending-label convention (useActionState) and are
    // deliberately left alone here.
    function onSubmit(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const method = (form.getAttribute('method') || 'get').toLowerCase();
      if (method !== 'get') return;
      start();
    }

    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('submit', onSubmit);
    };
  }, [start]);

  return (
    <NavigationLoadingContext.Provider value={start}>
      <Suspense fallback={null}>
        <RouteChangeListener onRouteChange={handleRouteChange} />
      </Suspense>
      {children}
      {loading && <NavigationLoadingOverlay />}
    </NavigationLoadingContext.Provider>
  );
}

export function useNavigationLoading() {
  return useContext(NavigationLoadingContext);
}

function NavigationLoadingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-md"
    >
      <div className="flex flex-col items-center gap-5">
        <div className="relative flex size-20 items-center justify-center">
          <span className="absolute inset-0 rounded-full border-2 border-gold/25" />
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-gold" />
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/idoc-logo.svg" alt="" aria-hidden="true" className="h-9 w-auto animate-pulse" />
        </div>
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-gold">Loading</span>
      </div>
    </div>
  );
}
