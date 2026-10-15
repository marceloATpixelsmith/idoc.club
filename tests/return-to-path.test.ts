import assert from 'node:assert/strict';
import test from 'node:test';
import { returnToFromRequestUrl, safeProtectedReturnTo } from '../lib/auth/return-to-path.ts';

test('return-to accepts only protected same-origin paths', () => {
  assert.equal(safeProtectedReturnTo('/admin/members?page=2'), '/admin/members?page=2');
  assert.equal(safeProtectedReturnTo('/dashboard'), '/dashboard');
  assert.equal(safeProtectedReturnTo('/onboarding/step'), '/onboarding/step');
  for (const bad of [null, '', '/', '/sign-in', '/api/user', '/administrator', '//evil.com/admin',
    'https://evil.com/admin', '/admin\\@evil.com', '/admin\r\nSet-Cookie: x=1', '/' + 'a'.repeat(600)]) {
    assert.equal(safeProtectedReturnTo(bad), null, String(bad));
  }
});

test('return-to drops the internal _rsc parameter', () => {
  assert.equal(returnToFromRequestUrl(new URL('https://idoc.club/admin/members?_rsc=abc&page=2')), '/admin/members?page=2');
  assert.equal(returnToFromRequestUrl(new URL('https://idoc.club/admin?_rsc=abc')), '/admin');
  assert.equal(returnToFromRequestUrl(new URL('https://idoc.club/pricing')), null);
});
