import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('sign-in does not expose a migrated-member activation link', () => {
  const passwordStep = read('app/(login)/sign-in/password-step.tsx');
  assert.doesNotMatch(passwordStep, /Migrated member\?|request-activation/);
});

test('legacy activation URL redirects into the normal sign-in entry point', () => {
  const page = read('app/(login)/request-activation/page.tsx');
  assert.match(page, /redirect\('\/sign-in'\)/);
  assert.doesNotMatch(page, /AccountLinkForm|requestMigrationActivation/);
});

test('migrated accounts enter one-time email verification through normal sign-in', () => {
  const actions = read('app/(login)/sign-in/actions.ts');
  assert.match(actions, /account\?\.accountState === 'migrated_pending'/);
  assert.match(actions, /issueEmailOtp\(email, 'login_verification'/);
  assert.match(actions, /startPendingLogin\(email, true\)/);
});

test('first migrated sign-in copy is migration-neutral', () => {
  const passwordCreate = read('app/(login)/sign-in/activate-password-step.tsx');
  assert.doesNotMatch(passwordCreate, /migrat|activat/i);
  assert.match(passwordCreate, /Your email is verified\. Set a password to continue\./);
});
