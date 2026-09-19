import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('app/(marketing)/contact/page.tsx', 'utf8');
const form = readFileSync('app/(marketing)/contact/contact-form.tsx', 'utf8');
const widget = readFileSync('components/turnstile-widget.tsx', 'utf8');
const widgetCss = readFileSync('components/turnstile-widget.css', 'utf8');

test('the contact page uses the same max-w-7xl container every other marketing page and the header/footer use, so its content starts at the same left edge as the page title above it', () => {
  assert.match(page, /mx-auto grid max-w-7xl gap-12/);
  assert.doesNotMatch(page, /max-w-5xl/);
});

test('the contact form renders TurnstileWidget bare, exactly like every canonical auth page call site, with no page-specific wrapper div -- the widget carries its own containment CSS now', () => {
  assert.match(form, /<TurnstileWidget key=\{turnstileAttempt\} action="contact" onVerify=\{setTurnstileToken\} theme="dark" \/>/);
  assert.doesNotMatch(form, /overflow-hidden/);
  assert.doesNotMatch(form, /\[&_iframe\]/);
});

test('TurnstileWidget imports its own containment stylesheet, so its layout behavior is identical for every caller regardless of which page loads it', () => {
  assert.match(widget, /import '\.\/turnstile-widget\.css'/);
  assert.match(widgetCss, /\.idoc-auth-turnstile \{/);
  assert.match(widgetCss, /\.idoc-auth-turnstile__error \{/);
  assert.match(widgetCss, /\.idoc-auth-turnstile__retry \{/);
});

test('TurnstileWidget accepts an optional theme override, defaulting to the canonical light theme every existing auth call site relies on', () => {
  assert.match(widget, /theme = 'light'/);
  assert.match(widget, /theme\?: 'dark' \| 'light'/);
});
