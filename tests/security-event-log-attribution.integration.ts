import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { issueEmailOtp } from '../lib/auth/email-otp.ts';
import { closeHarness, createUser, resetIdoc } from './postgres-harness.ts';

// AUTH-LOG-001's actor/subject attribution property, proven through the real production delivery
// path (issueEmailOtp), not a parallel helper: when a real caller resolves a userId before issuing
// an OTP (the login/password-reset purposes always do), a genuine provider delivery failure must
// carry that subject through to the emitted security event -- not merely document that it could.

process.env.RATE_LIMIT_HASH_KEY ??= 'integration-only-rate-limit-secret';

beforeEach(resetIdoc);
after(closeHarness);

test('a real email-OTP delivery failure attributes the security event to the actual resolved subject', async () => {
  const user = await createUser();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('provider unreachable'); };
  const calls: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    const result = await issueEmailOtp(user.email, 'login_verification', { userId: user.id });
    assert.equal(result.status, 'delivery_failed');
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }

  const emitted = calls.find(([event]) => event === 'email_otp_delivery_failed');
  assert.ok(emitted, 'the real delivery-failure path must emit the registered security event');
  const [, meta] = emitted as [string, Record<string, unknown>];
  assert.equal(meta.subjectId, user.id);
  assert.equal(meta.category, 'delivery');
  assert.equal(meta.resource, 'email-otp');
  assert.equal(meta.purpose, 'login_verification');
});

test('an anonymous email-OTP issuance (no resolved subject, e.g. signup verification) attributes subjectId null rather than omitting it silently', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('provider unreachable'); };
  const calls: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    const result = await issueEmailOtp('anonymous-signup@example.test', 'signup_verification');
    assert.equal(result.status, 'delivery_failed');
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }

  const [, meta] = calls.find(([event]) => event === 'email_otp_delivery_failed') as [string, Record<string, unknown>];
  assert.equal(meta.subjectId, null);
});
