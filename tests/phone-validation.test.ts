import assert from 'node:assert/strict';
import test from 'node:test';
import { memberPhoneSchema } from '../lib/membership/validation.ts';

test('accepts valid international E.164 phone numbers', () => {
  assert.equal(memberPhoneSchema.safeParse('+14155552671').success, true);
  assert.equal(memberPhoneSchema.safeParse('+525512345678').success, true);
});

test('rejects malformed phone numbers', () => {
  assert.equal(memberPhoneSchema.safeParse('555-1234').success, false);
  assert.equal(memberPhoneSchema.safeParse('+123').success, false);
});
