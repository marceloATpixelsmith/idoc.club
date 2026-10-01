import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('seminar and membership return-trip feedback uses cookie flash state instead of visible status query params', () => {
  const seminarCheckout = readFileSync('lib/seminars/checkout.ts', 'utf8');
  const seminarPage = readFileSync('app/(marketing)/seminars/[id]/page.tsx', 'utf8');
  const membershipCheckout = readFileSync('lib/payments/checkout.ts', 'utf8');
  const membershipReturn = readFileSync('app/api/stripe/checkout/route.ts', 'utf8');
  const membershipPage = readFileSync('app/(dashboard)/dashboard/membership/page.tsx', 'utf8');

  assert.doesNotMatch(seminarCheckout, /\?checkout=(?:success|canceled)/);
  assert.doesNotMatch(seminarPage, /searchParams: Promise<\{ checkout\?: string \}>/);
  assert.match(seminarPage, /readUiFlash\(\`\/seminars\/\$\{id\}\`\)/);
  assert.match(seminarPage, /FlashBanner/);
  assert.match(membershipCheckout, /success_url: \`\$\{baseUrl\}\/api\/stripe\/checkout\`/);
  assert.doesNotMatch(membershipCheckout, /session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.doesNotMatch(membershipReturn, /searchParams\.get\('session_id'\)/);
  assert.match(membershipReturn, /membership-checkout-success/);
  assert.doesNotMatch(membershipPage, /searchParams: Promise<\{ renew\?: string \}>/);
});

test('transient auth and profile feedback no longer uses application-owned query flags', () => {
  const loginActions = readFileSync('app/(login)/actions.ts', 'utf8');
  const signInActions = readFileSync('app/(login)/sign-in/actions.ts', 'utf8');
  const signupActions = readFileSync('app/(login)/sign-up/actions.ts', 'utf8');
  const recoveryActions = readFileSync('app/(login)/recover-password/actions.ts', 'utf8');
  const membershipActions = readFileSync('app/(dashboard)/dashboard/membership/membership-actions.ts', 'utf8');
  const securityActions = readFileSync('app/(dashboard)/dashboard/security/actions.ts', 'utf8');
  const googleCallback = readFileSync('app/api/auth/google/callback/route.ts', 'utf8');
  const googleStart = readFileSync('app/api/auth/google/start/route.ts', 'utf8');

  const combined = [loginActions, signInActions, signupActions, recoveryActions, membershipActions, securityActions, googleCallback, googleStart].join('\n');
  for (const forbidden of [
    '?password=changed',
    '?password=created',
    '?membership=canceled',
    '?reset=success',
    '?confirmDetails=1',
    '?stage=verify',
    '?stage=password',
    '?google=failed',
    '?google=link-required',
  ]) assert.doesNotMatch(combined, new RegExp(forbidden.replace(/[?]/g, '\\?')));

  assert.match(combined, /setUiFlash|setUiFlashOnResponse/);
});

test('flash utility is short-lived, HTTP-only, target-scoped, and explicitly consumable', () => {
  const source = readFileSync('lib/ui/flash-state.ts', 'utf8');
  const consumer = readFileSync('app/api/ui/flash/consume/route.ts', 'utf8');
  assert.match(source, /httpOnly: true/);
  assert.match(source, /sameSite: 'lax'/);
  assert.match(source, /MAX_AGE_SECONDS = 5 \* 60/);
  assert.match(source, /flash\?\.targetPath === targetPath/);
  assert.match(consumer, /clearUiFlash\(targetPath\)/);
});
