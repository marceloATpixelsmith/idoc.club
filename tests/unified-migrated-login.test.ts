import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('sign-in does not expose a migrated-member activation link', () => {
  const passwordStep = read('app/(login)/sign-in/password-step.tsx');
  assert.doesNotMatch(passwordStep, /Migrated member\?|request-activation/);
});

test('legacy activation fallback is not linked from normal sign-in', () => {
  const emailStep = read('app/(login)/sign-in/email-step.tsx');
  const passwordStep = read('app/(login)/sign-in/password-step.tsx');
  assert.doesNotMatch(`${emailStep}\n${passwordStep}`, /request-activation|Migrated member\?/);
});

test('anonymous login email entry is account-state neutral', () => {
  const actions = read('app/(login)/sign-in/actions.ts');
  assert.match(actions, /eligibleLoginOtpUser\(email\)/);
  assert.match(actions, /issueEmailOtp\(email, 'login_verification'/);
  assert.match(actions, /await startPendingLogin\(email, true\);\s*redirect\('\/sign-in'\);/);
  assert.doesNotMatch(actions, /if \(account\?\.accountState === 'migrated_pending'\)/);
  assert.doesNotMatch(actions, /issued\.status === '(?:rate_limited|cooldown|delivery_failed)'/);
});

test('migrated routing happens only after successful email verification', () => {
  const page = read('app/(login)/sign-in/page.tsx');
  const proofBoundary = page.indexOf('if (!pending.verified) return <OtpStep');
  const accountLookup = page.indexOf('db.select({ accountState: users.accountState })');
  const migratedBranch = page.indexOf("account?.accountState === 'migrated_pending'");
  assert.ok(proofBoundary >= 0 && accountLookup > proofBoundary && migratedBranch > accountLookup);
});

test('first migrated sign-in copy is migration-neutral', () => {
  const passwordCreate = read('app/(login)/sign-in/activate-password-step.tsx');
  const visibleCopy = [
    ...passwordCreate.matchAll(/(?:description|submitLabel|title)="([^"]+)"/g),
  ].map((match) => match[1]).join('\n');

  assert.match(visibleCopy, /Your email is verified\. Set a password to continue\./);
  assert.doesNotMatch(visibleCopy, /migrat|activat/i);
});
