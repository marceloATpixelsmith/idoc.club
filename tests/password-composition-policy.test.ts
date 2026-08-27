import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordSchema } from '../lib/auth/password-policy.ts';

const validPassword = 'StrongPassword1!';

test('password policy accepts a password meeting all required categories', () => {
  assert.equal(passwordSchema.safeParse(validPassword).success, true);
});

test('password policy rejects missing uppercase, lowercase, number, special character, or minimum length', () => {
  for (const password of [
    'strongpassword1!',
    'STRONGPASSWORD1!',
    'StrongPassword!!',
    'StrongPassword11',
    'Short1!',
  ]) {
    assert.equal(passwordSchema.safeParse(password).success, false, `expected rejection for ${password}`);
  }
});

test('password policy retains the 128-character maximum', () => {
  assert.equal(passwordSchema.safeParse(`Aa1!${'x'.repeat(124)}`).success, true);
  assert.equal(passwordSchema.safeParse(`Aa1!${'x'.repeat(125)}`).success, false);
});
