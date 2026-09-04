import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { measureClockSkewMs, runClockSkewCheck } from '../lib/observability/clock-skew-check.ts';
import { closeHarness, resetIdoc } from './postgres-harness.ts';

// AUTH-OPERATIONS-008: "... use monitored trusted UTC time with bounded skew." Drives the real
// production measureClockSkewMs/runClockSkewCheck functions against the real test Postgres instance --
// not a parallel helper -- proving skew is actually measured against the database's own clock, and
// that the alert fires above the bound but not below it.

process.env.RATE_LIMIT_HASH_KEY ??= 'clock-skew-test-rate-limit-secret';
process.env.IDOC_ADMIN_NOTIFICATION_EMAIL = 'ops@example.test';
process.env.BREVO_API_KEY ??= 'integration-only-provider-key';
process.env.BREVO_FROM_EMAIL ??= 'accounts@idoc.club';

const originalDateNow = Date.now;
const originalFetch = globalThis.fetch;
let sentAlerts: { subject: string }[] = [];

before(() => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://api.brevo.com/v3/smtp/email') {
      const body = JSON.parse(String(init?.body));
      sentAlerts.push({ subject: body.subject });
      return new Response('{"messageId":"<test@smtp-relay.brevo.com>"}', { status: 201 });
    }
    return originalFetch(input, init);
  };
});
beforeEach(async () => { await resetIdoc(); sentAlerts = []; Date.now = originalDateNow; });
after(async () => { Date.now = originalDateNow; globalThis.fetch = originalFetch; await closeHarness(); });

test('measureClockSkewMs reports near-zero skew against the real, unaltered application clock', async () => {
  const skewMs = await measureClockSkewMs();
  assert.ok(Math.abs(skewMs) < 2_000, `expected the real app clock and the real test database clock to agree within 2s, got ${skewMs}ms`);
});

test('a genuinely large forward skew (app clock far ahead of the database) is measured and alerted', async () => {
  const offsetMs = 60_000;
  Date.now = () => originalDateNow() + offsetMs;
  try {
    const result = await runClockSkewCheck();
    assert.ok(result.skewMs > 50_000, `expected the measured skew to reflect the injected +${offsetMs}ms offset, got ${result.skewMs}ms`);
    assert.equal(result.alerted, 1);
  } finally {
    Date.now = originalDateNow;
  }
  assert.equal(sentAlerts.length, 1);
  assert.match(sentAlerts[0].subject, /\[HIGH\]/);
  assert.match(sentAlerts[0].subject, /clock skew detected/);
});

test('a genuinely large backward skew (app clock far behind the database) is measured and alerted', async () => {
  const offsetMs = -60_000;
  Date.now = () => originalDateNow() + offsetMs;
  try {
    const result = await runClockSkewCheck();
    assert.ok(result.skewMs < -50_000, `expected the measured skew to reflect the injected ${offsetMs}ms offset, got ${result.skewMs}ms`);
    assert.equal(result.alerted, 1);
  } finally {
    Date.now = originalDateNow;
  }
  assert.equal(sentAlerts.length, 1);
});

test('skew within the bound never alerts', async () => {
  const result = await runClockSkewCheck();
  assert.ok(Math.abs(result.skewMs) < 5_000);
  assert.equal(result.alerted, 0);
  assert.equal(sentAlerts.length, 0);
});
