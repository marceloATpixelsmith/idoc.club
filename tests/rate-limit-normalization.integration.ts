import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRateLimit } from '../lib/security/rate-limit.ts';
import { normalizeEmail } from '../lib/membership/validation.ts';
import { closeHarness, resetIdoc, sql } from './postgres-harness.ts';

test.beforeEach(resetIdoc);
test.after(closeHarness);

test('case and whitespace variants of the same email normalize to one identical rate-limit bucket key, matching every real call site\'s normalize-then-limit order', async () => {
  const now = new Date();
  const variants = ['Ratelimit@Example.TEST', '  ratelimit@example.test  ', 'RATELIMIT@EXAMPLE.TEST'];
  const normalized = variants.map((value) => normalizeEmail(value));
  assert.ok(normalized.every((value) => value === normalized[0]), 'sanity: normalizeEmail collapses these to one identity');

  // The real per-email allowance is 3 requests per 15-minute window (lib/security/rate-limit.ts).
  // Each call below uses a different raw casing/whitespace variant but the same normalized identity
  // and a distinct origin, so only the shared email-keyed bucket -- not the origin-keyed one -- can
  // be what blocks the fourth request.
  const results: boolean[] = [];
  for (let i = 0; i < 4; i += 1) {
    results.push(await checkRateLimit('rate_limit_normalization_test', normalizeEmail(variants[i % variants.length]), `origin-${i}`, now));
  }
  assert.deepEqual(results, [true, true, true, false], 'the 4th request across casing/whitespace variants of the same email must be blocked');
});

test('an un-normalized casing variant is NOT recognized as the same bucket if a caller bypasses normalization: this is a caller-discipline requirement, not automatic', async () => {
  // This documents the actual, verified boundary: checkRateLimit itself hashes whatever string it is
  // given -- it does not call normalizeEmail internally. Every production call site normalizes first
  // (issueEmailOtp, the login/reset email-collection steps); this test proves that property is load-
  // bearing, not redundant, by showing raw un-normalized variants do NOT collide on their own.
  const now = new Date();
  const rawVariants = ['Bypass@Example.TEST', 'bypass@example.test', 'BYPASS@EXAMPLE.TEST'];
  for (const email of rawVariants) {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(await checkRateLimit('rate_limit_bypass_probe', email, `origin-${email}-${i}`, now), true);
    }
  }
});

test('two genuinely different normalized emails never share a bucket, and a limit hit on one never blocks the other', async () => {
  const now = new Date();
  const a = normalizeEmail('member-a@example.test');
  const b = normalizeEmail('member-b@example.test');
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await checkRateLimit('rate_limit_isolation_test', a, `origin-${i}`, now), true);
  }
  assert.equal(await checkRateLimit('rate_limit_isolation_test', a, 'origin-4', now), false, 'member-a is now over the limit');
  assert.equal(await checkRateLimit('rate_limit_isolation_test', b, 'origin-4', now), true, 'member-b is unaffected by member-a exhausting their own limit');
});

test('the IP-keyed bucket independently blocks a single origin issuing requests across many different emails', async () => {
  const now = new Date();
  const origin = 'shared-attacker-origin';
  const results: boolean[] = [];
  for (let i = 0; i < 11; i += 1) {
    results.push(await checkRateLimit('rate_limit_ip_bucket_test', normalizeEmail(`victim-${i}@example.test`), origin, now));
  }
  // 10 requests/15min per origin; the 11th (a brand-new email each time) must still be blocked by
  // the IP-keyed bucket even though every email-keyed bucket individually has plenty of headroom.
  assert.equal(results.filter(Boolean).length, 10);
  assert.equal(results.at(-1), false);
});

test('rotating the origin alone cannot bypass the per-email limit, and rotating the email alone cannot bypass the per-origin limit (the design the dual-bucket scheme exists to prevent)', async () => {
  const now = new Date();
  const email = normalizeEmail('rotation-target@example.test');
  // Exhaust the per-email allowance (3) while rotating the origin on every request.
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await checkRateLimit('rate_limit_rotation_test', email, `rotated-origin-${i}`, now), true);
  }
  assert.equal(await checkRateLimit('rate_limit_rotation_test', email, 'yet-another-rotated-origin', now), false, 'a fresh origin does not reset the email-keyed bucket');

  // Exhaust the per-origin allowance (10) against a fixed origin while rotating the email.
  const fixedOrigin = 'rotation-fixed-origin';
  const perOriginResults: boolean[] = [];
  for (let i = 0; i < 11; i += 1) {
    perOriginResults.push(await checkRateLimit('rate_limit_rotation_test_2', normalizeEmail(`rotated-email-${i}@example.test`), fixedOrigin, now));
  }
  assert.equal(perOriginResults.at(-1), false, 'a fresh email does not reset the origin-keyed bucket');
});

test('the persisted bucket rows never contain a raw email address or raw origin/IP value', async () => {
  const now = new Date();
  await checkRateLimit('rate_limit_secrecy_test', normalizeEmail('secret-holder@example.test'), '203.0.113.7', now);
  const rows = await sql<{ identifier_hash: string; origin_hash: string }[]>`
    select identifier_hash, origin_hash from idoc.account_request_limits where purpose = 'rate_limit_secrecy_test'`;
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.doesNotMatch(row.identifier_hash, /secret-holder|example\.test/);
    assert.doesNotMatch(row.origin_hash, /203\.0\.113\.7/);
    assert.match(row.identifier_hash, /^[0-9a-f]{64}$/, 'a SHA-256 hex digest, not a raw value');
    assert.match(row.origin_hash, /^[0-9a-f]{64}$/);
  }
});
