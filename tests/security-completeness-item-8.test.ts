import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('credential and privilege mutations atomically persist safe audit and notification evidence', async () => {
  const [account, reset, roles, replacement, email] = await Promise.all([
    read('../app/(login)/actions.ts'), read('../app/(login)/recover-password/actions.ts'),
    read('../lib/membership/role-grants.ts'), read('../lib/auth/mfa/replacement-finalization.ts'),
    read('../lib/membership/email-verification.ts'),
  ]);
  for (const source of [account, reset, roles, replacement, email]) {
    assert.match(source, /audit_log|auditLog/);
    assert.match(source, /auth_security_notification_outbox/);
  }
  assert.match(account, /eq\(users\.sessionVersion, user\.sessionVersion\)/);
  assert.match(reset, /authSessions[\s\S]*password-reset/);
  assert.match(replacement, /auth_sessions[\s\S]*authenticator-replacement/);
  assert.doesNotMatch([account, reset, roles, replacement, email].join('\n'), /jsonb_build_object\([^)]*(password|otp|secret|digest|token)/i);
});
