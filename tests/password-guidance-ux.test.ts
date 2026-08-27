import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync('lib/auth/password-policy.ts', 'utf8');
const component = readFileSync('components/auth/password-create-step.tsx', 'utf8');

test('password guidance exposes the minimum without advertising the maximum', () => {
  assert.match(policy, /label: 'At least 12 characters'/);
  assert.doesNotMatch(policy, /12[–-]128 characters/);
  assert.match(policy, /MAX_PASSWORD_LENGTH = 128/);
});

test('password guidance disappears as requirements are satisfied and reports only overflow', () => {
  assert.match(component, /unmetRequirements = PASSWORD_REQUIREMENTS\.filter/);
  assert.match(component, /unmetRequirements\.length > 0/);
  assert.match(component, /password\.length > MAX_PASSWORD_LENGTH/);
  assert.match(component, /Password must be 128 characters or fewer\./);
  assert.match(component, /disabled=!\{?allMet/);
});
