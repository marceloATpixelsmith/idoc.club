import assert from 'node:assert/strict';
import test from 'node:test';
import { guestContactSchema } from '../lib/seminars/guest-registration-validation.ts';
import { memberPhoneSchema } from '../lib/membership/validation.ts';

test('accepts valid international E.164 phone numbers', () => {
  assert.equal(memberPhoneSchema.safeParse('+14155552671').success, true);
  assert.equal(memberPhoneSchema.safeParse('+525512345678').success, true);
});

test('rejects malformed phone numbers', () => {
  assert.equal(memberPhoneSchema.safeParse('555-1234').success, false);
  assert.equal(memberPhoneSchema.safeParse('+123').success, false);
});

test('guest contact validation rejects bad email and control characters', () => {
  assert.equal(guestContactSchema.safeParse({
    email: 'not-an-email',
    firstName: 'Valid',
    lastName: 'Person',
    phone: '+14155552671',
  }).success, false);
  assert.equal(guestContactSchema.safeParse({
    email: 'valid@example.com',
    firstName: 'Bad\u0000Name',
    lastName: 'Person',
    phone: '+14155552671',
  }).success, false);
});

test('guest contact validation preserves legitimate international names', () => {
  assert.equal(guestContactSchema.safeParse({
    email: 'person@example.com',
    firstName: 'María-José',
    lastName: 'O’Connor',
    phone: '+525512345678',
  }).success, true);
});
