import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync('lib/auth/password-policy.ts', 'utf8');
const component = readFileSync('components/auth/password-create-step.tsx', 'utf8');

test('password policy requires length and all composition categories without advertising the maximum', () => {
  assert.match(policy, /label: 'At least 12 characters'/);
  assert.match(policy, /label: 'At least one uppercase letter'/);
  assert.match(policy, /label: 'At least one lowercase letter'/);
  assert.match(policy, /label: 'At least one number'/);
  assert.match(policy, /label: 'At least one special character'/);
  assert.doesNotMatch(policy, /12[–-]128 characters/);
  assert.match(policy, /MAX_PASSWORD_LENGTH = 128/);
  assert.match(policy, /\\p\{Lu\}/);
  assert.match(policy, /\\p\{Ll\}/);
  assert.match(policy, /\\p\{N\}/);
});

test('password guidance disappears requirement-by-requirement and reports only overflow', () => {
  assert.match(component, /unmetRequirements = PASSWORD_REQUIREMENTS\.filter/);
  assert.match(component, /unmetRequirements\.length > 0/);
  assert.match(component, /unmetRequirements\.map/);
  assert.match(component, /password\.length > MAX_PASSWORD_LENGTH/);
  assert.match(component, /Password must be 128 characters or fewer\./);
  assert.match(component, /disabled=\{!allMet \|\| pending\}/);
});
