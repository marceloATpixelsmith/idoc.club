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
  // Bumped by retry(): forces the <Script> element below to remount with a new key, which makes
  // next/script re-attempt fetching/executing the Cloudflare script from scratch. A plain state
  // reset alone would not re-trigger a <script> tag that's already sitting in the DOM having
  // never fired onLoad or onError (the exact "silently dropped by a network filter" case this
  // widget already has to handle below). Also included in both effects' dependency arrays so a
  // retry re-renders an already-loaded widget in place and restarts the load-timeout window.
  const [attempt, setAttempt] = useState(0);

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
  }, [action, scriptLoaded, siteKey, attempt]);

  // The Cloudflare script sometimes never fires onLoad/onError at all (blocked by a
  // network filter or extension rather than a request that fails outright), which would
  // otherwise leave the widget silently absent and the gated submit button permanently
  // disabled with no explanation. Surface an actionable message once a load is overdue.
  useEffect(() => {
    if (scriptLoaded) return undefined;
    const timer = window.setTimeout(() => setFailed(true), SCRIPT_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [scriptLoaded, attempt]);

  // A prior version reloaded the whole page here, which silently discarded whatever the member
  // had already typed into the surrounding form -- confirmed as a real, frequent complaint, not
  // just a theoretical one. Retrying in place costs nothing and preserves it: bumping `attempt`
  // alone is enough to cover both failure shapes above (see the effects it's threaded into).
  function retry() {
    setFailed(false);
    setAttempt((value) => value + 1);
  }

  if (!siteKey) return null;
  return (
    <div className="idoc-auth-turnstile">
      <Script
        key={attempt}
        onError={() => setFailed(true)}
        onLoad={() => setScriptLoaded(true)}
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <div ref={containerRef} />
      {/* Reserves visible space and gives an explicit reason the submit button below stays
       * disabled while the widget hasn't rendered yet -- previously this window was an empty,
       * unexplained gap, and a member who started filling the form had no way to tell "still
       * loading" apart from "broken." */}
      {!scriptLoaded && !failed ? (
        <p className="idoc-auth-turnstile__loading" aria-live="polite">Loading security check…</p>
      ) : null}
      {failed ? (
        <p className="idoc-auth-turnstile__error" role="alert">
          The security check didn&apos;t load. Check your connection or disable any script/ad
          blockers, then{' '}
          <button
            className="idoc-auth-turnstile__retry"
            onClick={retry}
            type="button"
          >
            try again
          </button>
          .
        </p>
      ) : null}
    </div>
  );
}
