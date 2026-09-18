import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('app/(marketing)/contact/page.tsx', 'utf8');
const form = readFileSync('app/(marketing)/contact/contact-form.tsx', 'utf8');
const widget = readFileSync('components/turnstile-widget.tsx', 'utf8');

test('the contact page uses the same max-w-7xl container every other marketing page and the header/footer use, so its content starts at the same left edge as the page title above it', () => {
  assert.match(page, /mx-auto grid max-w-7xl gap-12/);
  assert.doesNotMatch(page, /max-w-5xl/);
});

test('the contact form\'s Turnstile widget is dark-themed and its own containment is replicated, since this page never loads components/auth/canonical-reference.css', () => {
  assert.match(form, /theme="dark"/);
  assert.match(form, /overflow-hidden/);
  assert.match(form, /\[&_iframe\]:max-w-full/);
});

test('TurnstileWidget accepts an optional theme override, defaulting to the canonical light theme every existing auth call site relies on', () => {
  assert.match(widget, /theme = 'light'/);
  assert.match(widget, /theme\?: 'dark' \| 'light'/);
});
