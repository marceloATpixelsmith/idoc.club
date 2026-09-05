import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const widget = readFileSync('components/turnstile-widget.tsx', 'utf8');

test('a script load failure (blocked/offline) is caught and surfaces a fallback, rather than leaving the widget silently absent forever', () => {
  assert.match(widget, /onError=\{?\(\) => setFailed\(true\)/);
});

test('a Turnstile render-time error is caught via error-callback, not left to fail silently', () => {
  assert.match(widget, /'error-callback': \(\) => setFailed\(true\)/);
});

test('an expired token clears the parent form state instead of leaving a stale token that will only fail on submit', () => {
  assert.match(widget, /'expired-callback': \(\) => onVerify\?\.\(''\)/);
});

test('a script that never fires onLoad or onError at all (silently dropped by a network filter) still times out into the fallback', () => {
  assert.match(widget, /SCRIPT_LOAD_TIMEOUT_MS/);
  assert.match(widget, /window\.setTimeout\(\(\) => setFailed\(true\), SCRIPT_LOAD_TIMEOUT_MS\)/);
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
  assert.match(retryBody, /if \(window\.turnstile\) \{\s*renderWidget\(\);\s*return;\s*\}/);
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

test('a visible, explicit loading state is shown while the widget has not yet rendered or failed, so the disabled submit button is not unexplained', () => {
  assert.match(widget, /idoc-auth-turnstile__loading/);
  assert.match(widget, /!scriptLoaded && !failed/);
  assert.match(widget, /Loading security check/);
});

test('the real Turnstile widget configuration itself is untouched by the resilience changes', () => {
  assert.match(widget, /size: 'flexible'/);
  assert.match(widget, /theme: 'light'/);
  assert.match(widget, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.match(widget, /challenges\.cloudflare\.com\/turnstile/);
});
