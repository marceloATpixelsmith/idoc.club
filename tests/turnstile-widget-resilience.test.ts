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

test('retrying never reloads the page: a member who already typed into the surrounding form must not lose it', () => {
  assert.doesNotMatch(widget, /window\.location\.reload/);
});

test('retry gives the <Script> a genuinely different src, not just a new React key -- next/script caches load state by src and never re-fires onLoad/onError for a repeated one', () => {
  assert.match(widget, /const \[attempt, setAttempt\] = useState\(0\)/);
  assert.match(widget, /key=\{attempt\}/);
  assert.match(widget, /src=\{`https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit&retry=\$\{attempt\}`\}/);
  const retryBody = widget.slice(widget.indexOf('function retry()'), widget.indexOf('if (!siteKey) return null;'));
  assert.match(retryBody, /setAttempt\(\(value\) => value \+ 1\)/);
});

test('the widget-render effect and the load-timeout effect both re-run on retry (attempt is a dependency of each)', () => {
  assert.match(widget, /\}, \[action, scriptLoaded, siteKey, attempt\]\);/);
  assert.match(widget, /\}, \[scriptLoaded, attempt\]\);/);
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
