'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { saveFormValuesForRetryReload } from '@/lib/auth/turnstile-retry-restore';

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
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

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
  // Lazily checks window.turnstile at mount time as a fast path, but the real fix below is using
  // next/script's onReady callback rather than onLoad. onLoad fires exactly once per script src,
  // globally across the whole app -- so on a client-side (soft) navigation to a second page whose
  // widget mounts fresh (e.g. clicking "Forgot password?" from the login page), a first-mount-time
  // check for window.turnstile can still race a script that is still loading at that exact instant
  // (a Codex review finding on the initial version of this fix): if it finishes a moment after this
  // component's initial render but before onReady is wired up, onLoad would never fire again for
  // this new instance and the widget would wait out the full timeout regardless of the lazy check.
  // onReady exists precisely for this: per Next.js's own docs it fires after the script loads AND
  // on every subsequent mount of a <Script> with the same src, so it always tells a later page's
  // widget the script is ready, whether that happens at mount or shortly after.
  const [scriptLoaded, setScriptLoaded] = useState(() => typeof window !== 'undefined' && !!window.turnstile);
  const [failed, setFailed] = useState(false);

  // Removes any existing widget from the container before rendering a fresh one, so retry() can
  // always call this safely regardless of whether a widget already occupies the container --
  // calling turnstile.render() a second time into the same container without first removing the
  // prior widget would leave two instances stacked in the same node.
  function renderWidget() {
    if (!containerRef.current || !window.turnstile) return;
    if (widgetIdRef.current) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        action,
        appearance: 'interaction-only',
        callback: onVerify,
        'error-callback': () => setFailed(true),
        'expired-callback': () => onVerify?.(''),
        sitekey: siteKey,
        size: 'flexible',
        theme: 'light',
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    if (!scriptLoaded || !siteKey) return undefined;
    if (!window.turnstile) {
      setFailed(true);
      return undefined;
    }
    renderWidget();
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

  // Two prior attempts at "retry" here tried to force api.js to load a second time -- first by
  // remounting the <Script> element with a new React key, then by giving it a cache-busted src.
  // Both are unsafe: Cloudflare's own script explicitly refuses to be initialized a second time
  // ("Turnstile already has been loaded. Was Turnstile imported multiple times?"), and confirmed
  // against a real, persistent production failure -- if the original, seemingly-dead load
  // eventually succeeds late (just slow, not actually blocked), a forced second load collides with
  // it and corrupts Turnstile's internal state rather than fixing anything. The correct model,
  // matching Cloudflare's own reference integrations: load the script exactly once, ever, and let
  // Turnstile's own built-in widget-level retry (`retry: 'auto'`, the default we never override)
  // handle transient failures by calling render() again -- never touching the script tag at all.
  // If the script genuinely never loaded even once, there is no safe in-place fix; a real page
  // reload is the only way to get a genuinely clean environment, so retry saves the member's
  // typed email first (the only field this widget's form ever has) so the reload doesn't cost it.
  function retry() {
    if (window.turnstile) {
      renderWidget();
      return;
    }
    saveFormValuesForRetryReload(containerRef.current?.closest('form') ?? null);
    window.location.reload();
  }

  if (!siteKey) return null;
  return (
    <div className="idoc-auth-turnstile">
      <Script
        onError={() => setFailed(true)}
        onReady={() => setScriptLoaded(true)}
        src={SCRIPT_SRC}
        strategy="afterInteractive"
      />
      <div ref={containerRef} />
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
