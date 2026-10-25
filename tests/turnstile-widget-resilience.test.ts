import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const widget = readFileSync('components/turnstile-widget.tsx', 'utf8');

test('a script load failure (blocked/offline) is caught and surfaces a fallback, rather than leaving the widget silently absent forever', () => {
  assert.match(widget, /onError=\{\(\) => fail\('script_not_loaded'\)/);
});

test('a Turnstile render-time error is caught via error-callback, not left to fail silently', () => {
  assert.match(widget, /'error-callback': \(errorCode\?: unknown\) => fail\('widget_error', errorCode\)/);
});

test('an expired token clears the parent form state instead of leaving a stale token that will only fail on submit', () => {
  assert.match(widget, /'expired-callback': \(\) => onVerify\?\.\(''\)/);
});

test('a script that never fires onLoad or onError at all (silently dropped by a network filter) still times out into the fallback', () => {
  assert.match(widget, /SCRIPT_LOAD_TIMEOUT_MS/);
  assert.match(widget, /window\.setTimeout\(\(\) => fail\('script_not_loaded'\), SCRIPT_LOAD_TIMEOUT_MS\)/);
});

test('scriptLoaded is initialized from whether window.turnstile already exists at mount time, as a fast path for a second widget instance mounted after a client-side navigation where the script is already resident', () => {
  assert.match(widget, /useState\(\(\) => typeof window !== 'undefined' && !!window\.turnstile\)/);
});

test('the Script tag uses onReady, not onLoad, to set scriptLoaded -- onLoad fires exactly once per src globally, which would race a script that is still loading at exact mount time (a second page whose widget mounts just before an earlier page-triggered load finishes); onReady fires after load AND on every subsequent mount, so it can never miss a script that becomes ready shortly after this component mounts', () => {
  assert.match(widget, /onReady=\{?\(\) => setScriptLoaded\(true\)/);
  assert.doesNotMatch(widget, /onLoad=\{?\(\) => setScriptLoaded\(true\)/);
});

test('the fallback message is actionable: it explains likely causes and offers a retry', () => {
  assert.match(widget, /idoc-auth-turnstile__error/);
  assert.match(widget, /idoc-auth-turnstile__retry/);
  assert.match(widget, /onClick=\{retry\}/);
});

test('the script tag has a fixed, unchanging src -- never a cache-busted or React-keyed one -- so it is only ever inserted once, matching Cloudflare\'s own reference integrations which explicitly guard against loading the script twice', () => {
  assert.match(widget, /const SCRIPT_SRC = 'https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit';/);
  assert.match(widget, /src=\{SCRIPT_SRC\}/);
  assert.doesNotMatch(widget, /key=\{/);
  assert.doesNotMatch(widget, /useState\(0\)/);
});

test('retry only reloads the script tag as a last resort: if Turnstile already loaded once (window.turnstile exists), retry calls render() again in place and never touches the <Script> element at all', () => {
  const retryBody = widget.slice(widget.indexOf('function retry()'), widget.indexOf('if (!siteKey) return null;'));
  assert.match(retryBody, /if \(window\.turnstile\) \{\s*setFailed\(false\);\s*bumpRetryEpoch\(\);\s*return;\s*\}/);
  assert.match(widget, /\[action, retryEpoch, scriptLoaded, siteKey, theme, updateChallengeVisibility\]/);
});

test('retry only forces a page reload when the script genuinely never loaded at all, and saves the member\'s typed email first so the reload does not cost it', () => {
  const retryBody = widget.slice(widget.indexOf('function retry()'), widget.indexOf('if (!siteKey) return null;'));
  assert.match(retryBody, /saveFormValuesForRetryReload\(containerRef\.current\?\.closest\('form'\) \?\? null\)/);
  assert.match(retryBody, /window\.location\.reload\(\)/);
});

test('renderWidget always removes any existing widget from the container before rendering a fresh one, so calling it again (from retry, or a normal script-load effect re-run) can never stack two widgets in the same container', () => {
  const renderWidgetBody = widget.slice(widget.indexOf('function renderWidget()'), widget.indexOf('useEffect(() => {\n    if (!scriptLoaded'));
  assert.match(renderWidgetBody, /if \(widgetIdRef\.current\) \{\s*window\.turnstile\.remove\(widgetIdRef\.current\);\s*widgetIdRef\.current = null;\s*\}/);
});

test('the managed widget stays hidden while loading or passing silently and appears only when interaction is required', () => {
  assert.match(widget, /appearance: 'interaction-only'/);
  assert.doesNotMatch(widget, /idoc-auth-turnstile__loading/);
});

test('the real Turnstile widget configuration itself is untouched by the resilience changes', () => {
  assert.match(widget, /size: 'flexible'/);
  assert.match(widget, /theme = 'dark'/);
  assert.match(widget, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.match(widget, /challenges\.cloudflare\.com\/turnstile/);
});

test('hidden interaction-only Turnstile collapses its layout wrapper without removing the widget DOM', () => {
  assert.match(widget, /data-challenge-visible=/);
  assert.match(widget, /height: 0, minHeight: 0, margin: '-8px 0', padding: 0/);
  assert.doesNotMatch(widget, /display: 'none'/);
});

test('Turnstile visibility is observed asynchronously and observers are cleaned up on unmount', () => {
  assert.match(widget, /new MutationObserver\(updateChallengeVisibility\)/);
  assert.match(widget, /new ResizeObserver\(updateChallengeVisibility\)/);
  assert.match(widget, /mutationObserver\?\.disconnect\(\)/);
  assert.match(widget, /resizeObserver\?\.disconnect\(\)/);
});

test('visible challenges and Turnstile errors preserve layout space', () => {
  assert.match(widget, /style=\{challengeVisible \|\| failed \? undefined/);
  assert.match(widget, /getBoundingClientRect\(\)/);
  assert.match(widget, /setChallengeVisible\(visible\)/);
});

test('a required interactive challenge is shown via Cloudflare\'s own callbacks, and a tokenless widget never stays hidden', () => {
  assert.match(widget, /'before-interactive-callback'/);
  assert.match(widget, /'after-interactive-callback'/);
  assert.match(widget, /hasVisibleContent \|\| interactiveRef\.current/);
  assert.match(widget, /attempts >= TOKEN_WATCHDOG_ATTEMPTS\) \{[\s\S]*?fail\('no_token_after_retries'\)/);
  assert.ok(
    widget.indexOf('challengeVisibleRef.current) return') < widget.indexOf('attempts >= TOKEN_WATCHDOG_ATTEMPTS'),
    'an on-screen challenge is exempt before retries are declared exhausted'
  );
  assert.match(widget, /if \(token\.length > 0\) setFailed\(false\)/);
});

test('a widget that rendered but issued no token (e.g. after a server-action redirect) is re-rendered in place a bounded number of times, and a missed onReady is recovered by polling window.turnstile', () => {
  assert.match(widget, /TOKEN_WATCHDOG_MS/);
  assert.match(widget, /TOKEN_WATCHDOG_ATTEMPTS/);
  assert.match(widget, /tokenIssuedRef\.current/);
  assert.match(widget, /window\.clearInterval\(watchdog\)/);
  assert.match(widget, /challengeVisibleRef\.current\) return/);
  assert.match(widget, /if \(window\.turnstile\) setScriptLoaded\(true\)/);
});

test('the token watchdog waits longer than Cloudflare\'s built-in 8 second widget retry', () => {
  const match = widget.match(/const TOKEN_WATCHDOG_MS = ([0-9_]+);/);
  assert.ok(match && Number(match[1].replace(/_/g, '')) > 8000);
});

test('every state that leaves Sign In disabled is reported through one categorical channel, and never through the emailing /api/client-error route', () => {
  for (const stage of ['script_not_loaded', 'render_failed', 'widget_error', 'unsupported_browser', 'no_token_after_retries']) {
    assert.match(widget, new RegExp(`fail\\('${stage}'`));
  }
  assert.match(widget, /reportTurnstileFailure\(stage, action, errorCode\);\s*setFailed\(true\)/);
  assert.doesNotMatch(widget, /client-error|reportClientError/);
});
