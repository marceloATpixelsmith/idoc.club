'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_LOAD_TIMEOUT_MS = 10_000;

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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!scriptLoaded || !siteKey || !containerRef.current) return undefined;
    if (!window.turnstile) {
      setFailed(true);
      return undefined;
    }
    setFailed(false);
    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        action,
        callback: onVerify,
        'error-callback': () => setFailed(true),
        'expired-callback': () => onVerify?.(''),
        sitekey: siteKey,
        size: 'flexible',
        theme: 'light',
      });
    } catch {
      setFailed(true);
    }
    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- changing callback identity must not reset a solved challenge.
  }, [action, scriptLoaded, siteKey]);

  // The Cloudflare script sometimes never fires onLoad/onError at all (blocked by a
  // network filter or extension rather than a request that fails outright), which would
  // otherwise leave the widget silently absent and the gated submit button permanently
  // disabled with no explanation. Surface an actionable message once a load is overdue.
  useEffect(() => {
    if (scriptLoaded) return undefined;
    const timer = window.setTimeout(() => setFailed(true), SCRIPT_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [scriptLoaded]);

  if (!siteKey) return null;
  return (
    <div className="idoc-auth-turnstile">
      <Script
        onError={() => setFailed(true)}
        onLoad={() => setScriptLoaded(true)}
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <div ref={containerRef} />
      {failed ? (
        <p className="idoc-auth-turnstile__error" role="alert">
          The security check didn&apos;t load. Check your connection or disable any script/ad
          blockers, then{' '}
          <button
            className="idoc-auth-turnstile__retry"
            onClick={() => window.location.reload()}
            type="button"
          >
            refresh the page
          </button>
          .
        </p>
      ) : null}
    </div>
  );
}
