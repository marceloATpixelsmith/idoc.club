import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySessionGate, paymentOnlyAllows, paymentOnlyDestination } from '../lib/membership/session-gate.ts';

const today = '2026-10-04';
const member = (status: string, validUntil: string, graceEndsOn: string | null = null) => ({ graceEndsOn, status, validUntil });
const gate = (membership: ReturnType<typeof member> | null, extra: Partial<{ accountState: string; privileged: boolean }> = {}) =>
  classifySessionGate({ accountState: 'active', membership, privileged: false, today, ...extra });

test('an entitled member, a member in payment grace, and a complimentary member see the whole site', () => {
  assert.equal(gate(member('active', '2027-01-01')), 'open');
  assert.equal(gate(member('grace', '2026-09-30', '2026-10-05')), 'open');
  assert.equal(gate(member('complimentary', '2027-01-01')), 'open');
});

test('a member who has not paid, or whose membership lapsed, sees only the payment page', () => {
  assert.equal(gate(null), 'payment_only');
  assert.equal(gate(member('expired', '2026-01-01')), 'payment_only');
  assert.equal(gate(member('active', '2026-10-03')), 'payment_only');
  assert.equal(gate(member('grace', '2026-09-20', '2026-10-03')), 'payment_only');
  assert.equal(gate(member('review_required', '2027-01-01')), 'payment_only');
  assert.equal(gate(member('suspended', '2027-01-01')), 'payment_only');
});

test('an account that has not finished onboarding is held to the onboarding wizard', () => {
  assert.equal(gate(null, { accountState: 'onboarding' }), 'payment_only');
  assert.equal(paymentOnlyDestination('onboarding'), '/dashboard');
  assert.equal(paymentOnlyDestination('active'), '/dashboard/membership');
});

test('a canceled membership keeps working through its paid-through date and then ends the relationship', () => {
  assert.equal(gate(member('canceled', '2026-10-04')), 'open');
  assert.equal(gate(member('canceled', '2027-03-01')), 'open');
  assert.equal(gate(member('canceled', '2026-10-03')), 'ended');
  assert.equal(gate(member('canceled', '2025-01-01')), 'ended');
});

test('administrators are never gated by membership, and states this policy does not govern stay open', () => {
  assert.equal(gate(null, { privileged: true }), 'open');
  assert.equal(gate(member('canceled', '2020-01-01'), { privileged: true }), 'open');
  assert.equal(gate(null, { accountState: 'suspended' }), 'open');
});

test('a payment-only session may reach only the payment page and what it depends on', () => {
  for (const path of ['/dashboard', '/dashboard/membership', '/onboarding', '/api/stripe/checkout', '/api/stripe/webhook', '/api/ui/flash/consume', '/api/user', '/api/auth/google/start', '/api/auth/google/callback', '/api/address/autocomplete', '/api/health', '/sign-in', '/mfa', '/terms', '/privacy', '/logo.svg', '/_next/static/chunk.js']) {
    assert.equal(paymentOnlyAllows(path), true, path);
  }
  for (const path of ['/', '/seminars', '/seminars/12', '/about', '/about/members-directory', '/news', '/contact', '/membership', '/dashboard/profile', '/dashboard/security', '/dashboard/support', '/dashboard/seminars', '/admin', '/admin/members', '/dashboard-evil', '/api/auth/google/link/start', '/api/auth/google/link/status', '/api/admin/export/members', '/api/team', '/api/users']) {
    assert.equal(paymentOnlyAllows(path), false, path);
  }
});
