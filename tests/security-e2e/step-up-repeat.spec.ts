import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { E2E_TOTP_SECRET } from './global-setup';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret: string) {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    accumulator = (accumulator << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) { bytes.push((accumulator >>> (bits - 8)) & 255); bits -= 8; }
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = digest.at(-1)! & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

// Regression: a second protected action on the same page used to open the authenticator dialog already disabled (and then
// close with an error), because the first verification's state was kept by the always-mounted dialog.
test('the authenticator dialog is usable again for a second protected action on the same page', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ storageState: '.security-e2e/super-administrator.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/security');

  await page.getByRole('button', { name: 'Generate new recovery codes' }).click();
  await expect(page.getByRole('heading', { name: 'Authenticator verification required' })).toBeVisible();
  await page.getByLabel('Authenticator code').fill(totp(E2E_TOTP_SECRET));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Authenticator verification required' })).toBeHidden({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Generate new recovery codes' }).click();
  const heading = page.getByRole('heading', { name: 'Authenticator verification required' });
  await expect(heading).toBeVisible();
  // Give a stale resume (the bug) time to disable the dialog and close it.
  await page.waitForTimeout(2_500);
  await expect(heading).toBeVisible();
  await expect(page.getByLabel('Authenticator code')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Verify and continue' })).toBeEnabled();
  await context.close();
});
