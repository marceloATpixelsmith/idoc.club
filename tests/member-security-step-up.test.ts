import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file: string) => readFileSync(file, 'utf8');

test('members must prove email possession before password change or revocation, while admin TOTP remains enforced', () => {
  const password = read('app/(login)/actions.ts');
  const security = read('app/(dashboard)/dashboard/security/actions.ts');
  const helper = read('lib/auth/member-security-step-up.ts');
  const hook = read('components/auth/fresh-step-up-action.tsx');
  assert.match(password, /comparePasswords\(currentPassword, user\.passwordHash\)/);
  assert.match(password, /requireMemberSecurityEmailProof\(user, 'member_password_change', memberSecurityCode\)/);
  assert.match(password, /!member && \(await requireFreshStepUp\(user, 'change-password'/);
  assert.match(security, /requireMemberSecurityEmailProof\(user, 'member_session_revoke', memberSecurityCode\)/g);
  assert.equal(security.match(/requireMemberSecurityEmailProof\(user, 'member_session_revoke', memberSecurityCode\)/g)?.length, 2);
  assert.match(security, /!member && \(await requireFreshStepUp\(user, 'revoke-sessions'/g);
  assert.match(helper, /verifyEmailOtp\(user\.email, purpose, untrustedCode, origin, user\.id\)/);
  assert.match(helper, /issueEmailOtp\(user\.email, purpose, \{ origin, userId: user\.id \}\)/);
  assert.match(hook, /attempt\.set\('memberSecurityCode', code\)/);
  assert.match(hook, /original\.forEach\(\(value, key\) => attempt\.append\(key, value\)\)/);
  assert.match(hook, /stepUpMethod === 'email'/);
});

test('member security OTPs are different from sign-in and recovery codes and the database allows both', () => {
  const email = read('lib/auth/email-otp.ts');
  const schema = read('lib/db/schema.ts');
  const migration = read('lib/db/migrations/0090_member_security_step_up_codes.sql');
  for (const purpose of ['member_password_change', 'member_session_revoke']) {
    assert.match(email, new RegExp(purpose));
    assert.match(schema, new RegExp(purpose));
    assert.match(migration, new RegExp(purpose));
  }
  assert.match(email, /MAX_VERIFY_ATTEMPTS = 5/);
  assert.match(email, /RESEND_COOLDOWN_MS = 30 \* 1000/);
});

test('Sentry key-cap tooling checks provider settings rather than relying on SDK-side sampling', () => {
  const audit = read('scripts/check-sentry-ingestion-limits.mjs');
  const workflow = read('.github/workflows/sentry-ingestion-key-security.yml');
  assert.match(audit, /projects\/.*keys\//);
  assert.match(audit, /rateLimit/);
  assert.match(audit, /--apply/);
  assert.match(audit, /SENTRY_SECURITY_AUTH_TOKEN/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: idoc-db-production-maintenance/);
});
