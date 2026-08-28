import assert from 'node:assert/strict';
import test from 'node:test';
import { userInitials } from '../lib/format/user-initials.ts';

test('a two-word name produces first-name and last-name initials in caps', () => {
  assert.equal(userInitials('Jane Doe', 'jane@example.test'), 'JD');
});

test('a middle name is ignored: only the first and last words contribute', () => {
  assert.equal(userInitials('Mary Jane Watson', 'mary@example.test'), 'MW');
});

test('surrounding and repeated whitespace does not change the result', () => {
  assert.equal(userInitials('  Jane   Doe  ', 'jane@example.test'), 'JD');
});

test('a lowercase name is still rendered in caps', () => {
  assert.equal(userInitials('jane doe', 'jane@example.test'), 'JD');
});

test('a single-word name uses only that initial', () => {
  assert.equal(userInitials('Cher', 'cher@example.test'), 'C');
});

test('a missing name falls back to the first letter of the email, in caps', () => {
  assert.equal(userInitials(null, 'zeta@example.test'), 'Z');
  assert.equal(userInitials(undefined, 'zeta@example.test'), 'Z');
});

test('a blank or whitespace-only name falls back to the email initial', () => {
  assert.equal(userInitials('', 'zeta@example.test'), 'Z');
  assert.equal(userInitials('   ', 'zeta@example.test'), 'Z');
});

test('the email address itself is never split on spaces (it has none): only its first character is used', () => {
  assert.equal(userInitials(null, 'zeta@example.test'), 'Z');
});
