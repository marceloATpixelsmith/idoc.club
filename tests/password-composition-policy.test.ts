import assert from 'node:assert/strict';
import test from 'node:test';
import { countPasswordCharacters, passwordSchema } from '../lib/auth/password-policy.ts';

const validPassword = 'StrongPassword1!';

// U+1D538 MATHEMATICAL DOUBLE-STRUCK CAPITAL A -- a real \p{Lu} uppercase letter represented as a
// UTF-16 surrogate pair (2 code units, 1 Unicode code point). Canonical password length must be
// measured in code points, not UTF-16 units, so client and server length behavior agree.
const ASTRAL_UPPERCASE = '𝔸';

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

test('countPasswordCharacters counts Unicode code points, not UTF-16 code units', () => {
  assert.equal(ASTRAL_UPPERCASE.length, 2);
  assert.equal(countPasswordCharacters(ASTRAL_UPPERCASE), 1);
  const five = ASTRAL_UPPERCASE.repeat(5);
  assert.equal(five.length, 10);
  assert.equal(countPasswordCharacters(five), 5);
});

test('a password with fewer than 12 real characters is rejected even though astral-plane characters inflate its UTF-16 length to 12+', () => {
  // 5 astral uppercase characters + 3 ASCII (lower/number/special) = 8 actual characters, satisfying
  // every composition rule, but only 13 UTF-16 units -- old .length-based validation would have
  // wrongly accepted this as "12 characters or more".
  const password = `${ASTRAL_UPPERCASE.repeat(5)}a1!`;
  assert.equal(password.length, 13);
  assert.equal(countPasswordCharacters(password), 8);
  const result = passwordSchema.safeParse(password);
  assert.equal(result.success, false);
  assert.ok(result.error?.issues.some((issue) => issue.message === 'Use at least 12 characters.'));
});

test('a password with 128 or fewer real characters is accepted even though astral-plane characters inflate its UTF-16 length past 128', () => {
  // 66 astral uppercase characters + 3 ASCII (lower/number/special) = 69 actual characters (well
  // within the 12-128 bound), but 135 UTF-16 units -- old .length-based validation would have
  // wrongly rejected this as "more than 128 characters".
  const password = `${ASTRAL_UPPERCASE.repeat(66)}a1!`;
  assert.equal(password.length, 135);
  assert.equal(countPasswordCharacters(password), 69);
  assert.equal(passwordSchema.safeParse(password).success, true);
});
