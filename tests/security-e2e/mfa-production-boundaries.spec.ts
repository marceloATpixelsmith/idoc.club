import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_RECOVERY_CODE, E2E_TOTP_SECRET } from './global-setup';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function totp(secret: string) {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    accumulator = (accumulator << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = digest.at(-1)! & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

test('live recovery remains constrained through replacement and acknowledgement', async ({ browser }) => {
  test.setTimeout(60_000);
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  const context = await browser.newContext({ storageState: '.security-e2e/administrator.json' });
  const page = await context.newPage();
  const [fixture] = await sql<{ id: number }[]>`select id from idoc.users where email='administrator@security.example.test'`;
  const before = await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions where user_id=${fixture.id} and revoked_at is null`;

  await page.goto('/dashboard/security');
  await page.getByRole('button', { name: 'Replace authenticator' }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  await page.getByLabel('Recovery code').fill(E2E_RECOVERY_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Set up authenticator')).toBeVisible();

  const afterRecovery = await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions where user_id=${fixture.id} and revoked_at is null`;
  expect(afterRecovery[0].count).toBe(before[0].count);
  expect((await context.cookies()).some(({ name }) => name === '__Host-idoc-session')).toBe(false);
  await page.getByLabel('Authenticator code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect');

  const uri = await page.getByLabel('Authenticator setup key').inputValue();
  const replacementSecret = new URL(uri).searchParams.get('secret');
  expect(replacementSecret).toBeTruthy();
  await page.getByLabel('Authenticator code').fill(totp(replacementSecret!));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Store these recovery codes somewhere safe.')).toBeVisible();
  const beforeAck = await sql<{ count: number }[]>`select count(*)::int count from idoc.auth_sessions where user_id=${fixture.id} and revoked_at is null`;
  expect(beforeAck[0].count).toBe(0);
  expect((await context.cookies()).some(({ name }) => name === 'idoc_pending_primary_mfa')).toBe(true);

  await page.getByLabel('I saved my recovery codes.').check();
  await page.getByRole('button', { name: 'Finish sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard\/security$/);
  const final = await sql<{ active: number; oldCodes: number; sessions: number }[]>`select
    (select count(*)::int from idoc.mfa_factors where user_id=${fixture.id} and status='active') active,
    (select count(*)::int from idoc.mfa_recovery_codes where user_id=${fixture.id} and consumed_at is not null) "oldCodes",
    (select count(*)::int from idoc.auth_sessions where user_id=${fixture.id} and revoked_at is null) sessions`;
  expect(final[0].active).toBe(1);
  expect(final[0].oldCodes).toBe(0);
  expect(final[0].sessions).toBe(1);
  expect((await context.cookies()).some(({ name }) => name === 'idoc_pending_primary_mfa')).toBe(false);
  await sql.end();
  await context.close();
});

test('real step-up action uses its isolated persisted rate-limit purpose and blocks at the limit', async ({ browser }) => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  await sql`delete from idoc.account_request_limits where purpose like 'mfa_%'`;
  const context = await browser.newContext({ storageState: '.security-e2e/super-administrator.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/security');
  await page.getByRole('button', { name: 'Generate new recovery codes' }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByLabel('Authenticator code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page.getByRole('alert')).toContainText('Too many attempts');
  const rows = await sql<{ purpose: string; request_count: number }[]>`select purpose,request_count from idoc.account_request_limits
    where purpose like 'mfa_%' order by purpose,request_count desc`;
  expect(rows.filter(({ purpose }) => purpose === 'mfa_step_up_verify')).toHaveLength(2);
  expect(rows.every(({ purpose }) => purpose === 'mfa_step_up_verify')).toBe(true);
  expect(rows.some(({ request_count }) => request_count === 4)).toBe(true);
  expect(JSON.stringify(rows)).not.toContain('000000');
  await sql.end();
  await context.close();
});
