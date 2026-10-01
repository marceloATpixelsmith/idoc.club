import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

test('every Brevo transactional send uses the single Accounts sender transport', () => {
  const transportPath = path.join(root, 'lib/notifications/brevo-transactional.ts');
  const transport = readFileSync(transportPath, 'utf8');
  assert.match(transport, /sender: \{ email: fromEmail, name: 'Accounts' \}/);
  assert.match(transport, /brevoFromEmailForServer\(\)/);

  const directBrevoSenders = [...sourceFiles(path.join(root, 'app')), ...sourceFiles(path.join(root, 'lib'))]
    .filter((file) => readFileSync(file, 'utf8').includes('https://api.brevo.com/v3/smtp/email'));

  assert.deepEqual(directBrevoSenders, [transportPath],
    'No auth, security, seminar, membership, or other email path may bypass the centralized Brevo transport.');
});

test('auth and account email producers use the centralized transactional transport', () => {
  for (const relative of [
    'app/(marketing)/contact/actions.ts',
    'lib/auth/email-otp.ts',
    'lib/membership/email-verification.ts',
    'lib/notifications/account-delivery.ts',
    'lib/notifications/auth-security-delivery.ts',
    'lib/notifications/breached-password-alert.ts',
    'lib/notifications/google-oauth-failure-alert.ts',
    'lib/notifications/operational-alert-delivery.ts',
    'lib/notifications/profile-change-delivery.ts',
    'lib/notifications/renewal-notices.ts',
  ]) {
    const source = readFileSync(path.join(root, relative), 'utf8');
    assert.match(source, /sendTransactionalEmail/,
      `${relative} must route mail through the Accounts-named transactional sender`);
  }
});
