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

/** Renders a Cloudflare Turnstile challenge with a trusted server-expected action name. The widget
 * itself requires JavaScript to solve, but once solved its token is submitted with the form and must
 * still be verified server-side. `onVerify` is optional progressive enhancement for UI that wants
 * to know the challenge is solved before submission. */
export function TurnstileWidget({
  action,
  onVerify,
}: {
  action: string;
  onVerify?: (token: string) => void;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    if (!scriptLoaded || !siteKey || !containerRef.current || !window.turnstile) return undefined;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      action,
      callback: onVerify,
      sitekey: siteKey,
      size: 'flexible',
    });
    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onVerify identity changes every render in some callers; re-rendering the widget on every keystroke would reset the solved challenge.
  }, [action, scriptLoaded, siteKey]);

  if (!siteKey) return null;
  return (
    <>
      <Script onLoad={() => setScriptLoaded(true)} src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" />
      <div className="w-full" ref={containerRef} />
    </>
  );
}
