import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRequestOrigin } from '../lib/security/request-origin.ts';

// resolveRequestOrigin is the pure logic behind requestOrigin() (lib/security/rate-limit.ts),
// factored out so it's testable without a Next.js request context. AUTH-RATE-004: X-Forwarded-For/
// X-Real-IP must only be trusted when Vercel's edge network is the actual, documented deployment
// topology -- outside that, they are ordinary client-controllable headers with no verifying proxy.

test('outside a Vercel deployment, X-Forwarded-For/X-Real-IP are never trusted, even when present and well-formed', () => {
  assert.equal(resolveRequestOrigin('203.0.113.7', null, false), 'unknown');
  assert.equal(resolveRequestOrigin(null, '203.0.113.7', false), 'unknown');
  assert.equal(resolveRequestOrigin('203.0.113.7', '198.51.100.1', false), 'unknown');
});

test('on a Vercel deployment, the first X-Forwarded-For entry is used', () => {
  assert.equal(resolveRequestOrigin('203.0.113.7, 10.0.0.1, 10.0.0.2', null, true), '203.0.113.7');
  assert.equal(resolveRequestOrigin(' 203.0.113.7 ,10.0.0.1', null, true), '203.0.113.7');
});

test('on a Vercel deployment, X-Real-IP is used when X-Forwarded-For is absent', () => {
  assert.equal(resolveRequestOrigin(null, '198.51.100.1', true), '198.51.100.1');
  assert.equal(resolveRequestOrigin('', '198.51.100.1', true), '198.51.100.1');
});

test('on a Vercel deployment, a genuinely valid IPv6 address is accepted', () => {
  assert.equal(resolveRequestOrigin('2001:db8::1', null, true), '2001:db8::1');
  assert.equal(resolveRequestOrigin(null, '::1', true), '::1');
});

test('on a Vercel deployment, neither header present collapses to unknown', () => {
  assert.equal(resolveRequestOrigin(null, null, true), 'unknown');
  assert.equal(resolveRequestOrigin('', '', true), 'unknown');
});

test('on a Vercel deployment, a value that does not look like an IP address is rejected as unknown rather than used verbatim', () => {
  // Not a real IP; the old .split(',')[0]?.trim() would have accepted this literally, letting an
  // attacker-chosen arbitrary string become the rate-limit bucket identifier.
  assert.equal(resolveRequestOrigin('attacker-controlled-string', null, true), 'unknown');
  assert.equal(resolveRequestOrigin('<script>alert(1)</script>', null, true), 'unknown');
  assert.equal(resolveRequestOrigin('', null, true), 'unknown');
});

test('on a Vercel deployment, an IPv4-shaped value with an out-of-range octet is rejected', () => {
  assert.equal(resolveRequestOrigin('999.999.999.999', null, true), 'unknown');
  assert.equal(resolveRequestOrigin('256.1.1.1', null, true), 'unknown');
});

test('on a Vercel deployment, a valid IPv4 X-Forwarded-For entry takes priority over a present X-Real-IP', () => {
  assert.equal(resolveRequestOrigin('203.0.113.7', '198.51.100.1', true), '203.0.113.7');
});

test('on a Vercel deployment, an invalid X-Forwarded-For entry fails safe to unknown rather than falling through to a present X-Real-IP', () => {
  // X-Forwarded-For, when present, is always the chosen candidate ahead of X-Real-IP -- an invalid
  // value there is rejected outright, not silently retried against a second header, which would
  // itself be a confusable-input surface.
  assert.equal(resolveRequestOrigin('not-an-ip', '198.51.100.1', true), 'unknown');
});
