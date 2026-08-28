import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const authStyles = read('components/auth/canonical-reference.css');
const pendingLabel = read('components/auth/pending-label.tsx');
const emailEntry = read('components/auth/email-entry-step.tsx');
const passwordCreate = read('components/auth/password-create-step.tsx');
const otpEntry = read('components/auth/otp-entry-step.tsx');
const loginPassword = read('app/(login)/sign-in/password-step.tsx');
const tokenForms = read('app/(login)/token-forms.tsx');
const mfaForm = read('app/(login)/mfa/mfa-form.tsx');

test('auth-page buttons are rendered in all caps via canonical CSS, not per-component markup', () => {
  assert.match(authStyles, /\.idoc-auth-button,\s*\n\.idoc-auth-google-button\s*\{[\s\S]*text-transform: uppercase;/);
});

test('canonical field and button geometry is untouched by the all-caps styling change', () => {
  assert.match(authStyles, /\.idoc-auth-button,[\s\S]*height: 48px/);
  assert.match(authStyles, /border-radius: 10px/);
});

test('the pending-state dots are a real CSS animation, not a static glyph, and respect reduced motion', () => {
  assert.match(authStyles, /@keyframes idoc-auth-button-blink/);
  assert.match(authStyles, /\.idoc-auth-button__dot\s*\{[\s\S]*animation: idoc-auth-button-blink/);
  assert.match(authStyles, /\.idoc-auth-button__dot:nth-child\(2\)\s*\{\s*animation-delay: 0\.2s;/);
  assert.match(authStyles, /\.idoc-auth-button__dot:nth-child\(3\)\s*\{\s*animation-delay: 0\.4s;/);
  assert.match(authStyles, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.idoc-auth-button__dot\s*\{\s*animation: none;/);
});

test('the shared pending-label component renders three decorative dots alongside the pending text', () => {
  assert.match(pendingLabel, /idoc-auth-button__pending/);
  assert.match(pendingLabel, /aria-hidden="true"/);
  assert.equal((pendingLabel.match(/idoc-auth-button__dot"/g) ?? []).length, 3);
});

test('every auth-page submit button renders its pending state through the shared animated label, not a static ellipsis string', () => {
  for (const [name, source] of [
    ['email-entry-step.tsx', emailEntry],
    ['password-create-step.tsx', passwordCreate],
    ['otp-entry-step.tsx', otpEntry],
    ['sign-in/password-step.tsx', loginPassword],
    ['token-forms.tsx', tokenForms],
    ['mfa/mfa-form.tsx', mfaForm],
  ] as const) {
    assert.match(source, /AuthPendingLabel/, `${name} must use the shared AuthPendingLabel component`);
    assert.doesNotMatch(source, /['"][A-Za-z ]+…['"]/, `${name} must not render a static ellipsis pending label`);
  }
});
