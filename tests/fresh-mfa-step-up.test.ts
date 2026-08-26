import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(path, 'utf8');

test('fresh authority is signed, five-minute, action and canonical-session bound', () => {
  const stepUp = source('lib/auth/mfa/step-up.ts');
  assert.match(stepUp, /const TTL_SECONDS = 5 \* 60/);
  assert.match(stepUp, /new SignJWT\(value\)/);
  assert.match(stepUp, /evidence\.action === action/);
  assert.match(stepUp, /evidence\.sessionId === session\.sessionId/);
  assert.match(stepUp, /evidence\.sessionVersion === user\.sessionVersion/);
  assert.match(stepUp, /evidence\.role === role/);
  assert.match(stepUp, /httpOnly: true/);
  assert.match(stepUp, /secure: true/);
  assert.doesNotMatch(stepUp, /recoveryCode|encryptedSecret|totpSecret/);
});

test('canonical policy and persisted purpose-bound challenge gate freshness', () => {
  const stepUp = source('lib/auth/mfa/step-up.ts');
  assert.match(stepUp, /sensitiveActionRequiresFreshStepUp\(/);
  assert.match(stepUp, /mfaStore\.createChallenge\(/);
  assert.match(stepUp, /purpose: 'step-up'/);
  assert.match(stepUp, /maxAttempts: 5/);
  assert.match(stepUp, /configuredFactor = binding\.role === 'admin' \|\| binding\.role === 'super-admin' \? 'totp' : 'none'/);
  assert.doesNotMatch(stepUp, /remembered/i);
});

test('step-up verification uses canonical TOTP and rate limiting without creating a session', () => {
  const actions = source('app/(login)/mfa/actions.ts');
  const verify = actions.slice(actions.indexOf('export const verifyStepUpTotp'), actions.indexOf('export const verifyLoginTotp'));
  assert.match(verify, /allowed\(context\.user\.id, 'mfa_step_up_verify'\)/);
  assert.match(verify, /verifyActiveTotp\(/);
  assert.match(verify, /purpose: 'step-up'/);
  assert.match(verify, /grantFreshStepUp\(/);
  assert.doesNotMatch(verify, /setSession\(|registerSession\(|recoveryCode/);
});

test('live privileged mutations require canonical sensitive actions', () => {
  const account = source('app/(login)/actions.ts');
  assert.match(account, /requireFreshStepUp\(user, 'change-password'/);
  assert.match(account, /if \(email !== user\.email\) \{\s+if \(\(await requireFreshStepUp\(user, 'change-email'/);
  const roles = source('lib/membership/role-grants.ts');
  assert.equal((roles.match(/requireFreshStepUp\(actor, 'change-privileged-permissions'/g) ?? []).length, 2);
  assert.equal((roles.match(/requireSuperAdmin\(actor\)/g) ?? []).length, 2);
  const security = source('app/(dashboard)/dashboard/security/actions.ts');
  assert.equal((security.match(/requireFreshStepUp\(user, 'change-security-settings'/g) ?? []).length, 2);
  assert.equal((security.match(/comparePasswords\(currentPassword, user\.passwordHash\)/g) ?? []).length, 2);
});

test('logout clears pending and granted step-up evidence', () => {
  const session = source('lib/auth/session.ts');
  assert.match(session, /cookieStore\.delete\('idoc_pending_step_up'\)/);
  assert.match(session, /cookieStore\.delete\('idoc_fresh_step_up'\)/);
});
