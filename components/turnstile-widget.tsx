'use client';

import Script from 'next/script';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { saveFormValuesForRetryReload } from '@/lib/auth/turnstile-retry-restore';
import { reportTurnstileFailure, type TurnstileFailureStage } from '@/lib/observability/turnstile-signal';
import './turnstile-widget.css';

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
// A widget that rendered but never produced a token (seen after a server-action redirect, e.g. the
// password-reset return to /sign-in, where only a manual refresh recovered it) is re-rendered in
// place rather than leaving the gated submit button disabled. Never touches the <Script> element.
// Longer than Cloudflare's own built-in widget retry interval (8 s, `retry: 'auto'`) so this never
// discards a widget that is about to retry itself.
const TOKEN_WATCHDOG_MS = 12_000;
const TOKEN_WATCHDOG_ATTEMPTS = 3;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function TurnstileWidget({
  action,
  onVerify,
  theme = 'light',
}: {
  action: string;
  onVerify?: (token: string) => void;
  /** The canonical auth reference (docs/13) forces every sign-in/sign-up/recovery usage to the
   * light theme regardless of this app's own dark background -- see
   * tests/canonical-auth-reference-adoption.test.ts and tests/turnstile-widget-resilience.test.ts,
   * which pin that contract. A caller outside that reference design (e.g. the public contact page,
   * which never loads components/auth/canonical-reference.css) may override it. */
  theme?: 'dark' | 'light';
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenIssuedRef = useRef(false);
  const challengeVisibleRef = useRef(false);
  // Set by Cloudflare's own before/after-interactive callbacks. This is the authoritative signal that
  // a challenge needs the visitor; the DOM sniffing in updateChallengeVisibility is only a fallback,
  // so a missed iframe never leaves a required challenge hidden behind the 0-height wrapper.
  const interactiveRef = useRef(false);
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
  // Bumped by a manual retry so the mount effect re-renders the widget AND re-arms the bounded
  // token watchdog; calling renderWidget() alone would leave a spent watchdog unable to resurface a
  // second stall.
  const [retryEpoch, bumpRetryEpoch] = useReducer((epoch: number) => epoch + 1, 0);
  const [challengeVisible, setChallengeVisible] = useState(false);

  // Every state that leaves the gated Sign In button disabled goes through here, so it is both shown
  // to the visitor and reported (once per page load, categorical only) for operators.
  function fail(stage: TurnstileFailureStage, errorCode?: unknown) {
    reportTurnstileFailure(stage, action, errorCode);
    setFailed(true);
  }

  // Removes any existing widget from the container before rendering a fresh one, so retry() can
  // always call this safely regardless of whether a widget already occupies the container --
  // calling turnstile.render() a second time into the same container without first removing the
  // prior widget would leave two instances stacked in the same node.
  const updateChallengeVisibility = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const hasVisibleContent = Array.from(container.querySelectorAll('iframe, [role="alert"]')).some((element) => {
      const styles = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return styles.display !== 'none' && styles.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });

    const visible = hasVisibleContent || interactiveRef.current;
    challengeVisibleRef.current = visible;
    setChallengeVisible(visible);
  }, []);

  function renderWidget() {
    if (!containerRef.current || !window.turnstile) return;
    if (widgetIdRef.current) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
    tokenIssuedRef.current = false;
    interactiveRef.current = false;
    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        action,
        appearance: 'interaction-only',
        callback: (token: string) => {
          tokenIssuedRef.current = token.length > 0;
          if (token.length > 0) setFailed(false);
          interactiveRef.current = false;
          updateChallengeVisibility();
          onVerify?.(token);
        },
        'after-interactive-callback': () => {
          interactiveRef.current = false;
          updateChallengeVisibility();
        },
        'before-interactive-callback': () => {
          interactiveRef.current = true;
          updateChallengeVisibility();
        },
        'error-callback': (errorCode?: unknown) => fail('widget_error', errorCode),
        'expired-callback': () => onVerify?.(''),
        'unsupported-callback': () => fail('unsupported_browser'),
        sitekey: siteKey,
        size: 'flexible',
        theme,
      });
      setFailed(false);
      window.requestAnimationFrame(updateChallengeVisibility);
    } catch {
      fail('render_failed');
    }
  }

  useEffect(() => {
    if (!scriptLoaded || !siteKey) return undefined;
    if (!window.turnstile) {
      fail('script_not_loaded');
      return undefined;
    }
    renderWidget();
    let attempts = 1;
    const watchdog = window.setInterval(() => {
      if (tokenIssuedRef.current) {
        window.clearInterval(watchdog);
        return;
      }
      // Never reset or flag a challenge the visitor is currently looking at or solving.
      if (challengeVisibleRef.current) return;
      if (attempts >= TOKEN_WATCHDOG_ATTEMPTS) {
        // Out of automatic retries with no token: never stay silently hidden and disabled; show the
        // widget area and the retry message so the member has a visible way forward.
        window.clearInterval(watchdog);
        fail('no_token_after_retries');
        return;
      }
      attempts += 1;
      renderWidget();
    }, TOKEN_WATCHDOG_MS);
    const container = containerRef.current;
    const mutationObserver = container ? new MutationObserver(updateChallengeVisibility) : null;
    const resizeObserver = container ? new ResizeObserver(updateChallengeVisibility) : null;
    if (container) {
      mutationObserver?.observe(container, { childList: true, subtree: true, attributes: true });
      resizeObserver?.observe(container);
    }
    updateChallengeVisibility();
    return () => {
      window.clearInterval(watchdog);
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- changing callback identity must not reset a solved challenge.
  }, [action, retryEpoch, scriptLoaded, siteKey, theme, updateChallengeVisibility]);

  // The Cloudflare script sometimes never fires onLoad/onError at all (blocked by a
  // network filter or extension rather than a request that fails outright), which would
  // otherwise leave the widget silently absent and the gated submit button permanently
  // disabled with no explanation. Surface an actionable message once a load is overdue.
  useEffect(() => {
    if (scriptLoaded) return undefined;
    // After a client-side navigation the resident script's onReady can be missed; pick it up by
    // polling window.turnstile instead of waiting for the failure timeout.
    const poll = window.setInterval(() => {
      if (window.turnstile) setScriptLoaded(true);
    }, 250);
    const timer = window.setTimeout(() => fail('script_not_loaded'), SCRIPT_LOAD_TIMEOUT_MS);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(timer);
    };
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
      setFailed(false);
      bumpRetryEpoch();
      return;
    }
    saveFormValuesForRetryReload(containerRef.current?.closest('form') ?? null);
    window.location.reload();
  }

  if (!siteKey) return null;
  return (
    <div
      className="idoc-auth-turnstile"
      data-challenge-visible={challengeVisible ? 'true' : 'false'}
      style={challengeVisible || failed ? undefined : { height: 0, minHeight: 0, margin: '-8px 0', padding: 0 }}
    >
      <Script
        onError={() => fail('script_not_loaded')}
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
