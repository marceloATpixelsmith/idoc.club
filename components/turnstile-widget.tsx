'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

// Matches the Window.turnstile declaration in packages/pixelsmith/contact-form/src/index.tsx —
// TypeScript requires identical global interface merges, not just compatible ones.
declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

/** Renders a Cloudflare Turnstile challenge. The widget itself requires JavaScript to solve (that
 * is inherent to what it verifies), but once solved it injects a hidden `cf-turnstile-response`
 * input into this div, which native form submission picks up like any other field — no client-side
 * submit handling required. `onVerify` is optional progressive enhancement for UI that wants to
 * know the challenge is solved (e.g. to enable a submit button) before the form is even submitted.
 *
 * Explicit rendering (`render=explicit` + calling `window.turnstile.render` ourselves once both the
 * script has loaded and the container div exists) is deliberate: Cloudflare's default implicit mode
 * scans the DOM for `.cf-turnstile` once, when the script executes, and never again — so on a route
 * where the div is added by React after that scan already ran (a very normal ordering with
 * `next/script`), the widget silently never renders until a full page reload happens to reorder
 * things correctly. Driving the render from React's own lifecycle removes that race entirely. */
export function TurnstileWidget({ onVerify }: { onVerify?: (token: string) => void }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    if (!scriptLoaded || !siteKey || !containerRef.current || !window.turnstile) return undefined;
    widgetIdRef.current = window.turnstile.render(containerRef.current, { callback: onVerify, sitekey: siteKey, size: 'flexible' });
    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onVerify identity changes every render in some callers; re-rendering the widget on every keystroke would reset the solved challenge.
  }, [scriptLoaded, siteKey]);

  if (!siteKey) return null;
  return (
    <>
      <Script onLoad={() => setScriptLoaded(true)} src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" />
      <div className="w-full" ref={containerRef} />
    </>
  );
}
