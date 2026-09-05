import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { E2E_TOTP_SECRET } from './global-setup';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase()) {
    const index = BASE32.indexOf(character);
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totpCounter(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / 30);
}

function totpCodeForCounter(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

let lastUsedCounter = -1;

// The server rejects a TOTP code whose 30-second counter does not strictly increase from the last
// one it accepted for this factor. Two step-up rounds in the same test can otherwise land in the
// same window and get the identical code, so this waits for a fresh counter before computing one.
async function freshTotpCode(secret: string): Promise<string> {
  let counter = totpCounter();
  while (counter <= lastUsedCounter) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    counter = totpCounter();
  }
  lastUsedCounter = counter;
  return totpCodeForCounter(secret, counter);
}

test('a privileged account can register and remove a passkey from the dashboard, using a real WebAuthn ceremony', async ({ browser }) => {
  // Two TOTP step-up rounds (each potentially waiting out a 30-second window for a fresh code) plus
  // a real WebAuthn ceremony genuinely need more than the default 30-second test timeout.
  test.setTimeout(90_000);
  // localhost, not the suite's usual 127.0.0.1 baseURL: see the BASE_URL comment in
  // playwright.security.config.ts for why a WebAuthn ceremony specifically needs a real domain.
  const context = await browser.newContext({ baseURL: 'http://localhost:3100', storageState: '.security-e2e/administrator-localhost.json' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  await page.goto('/dashboard/security');
  await expect(page.getByText('Passkeys', { exact: true })).toBeVisible();

  // A real production report: calling beginPasskeyRegistration directly (not through a <form>)
  // meant its internal redirect() to /mfa -- entirely expected, not a failure -- was caught by the
  // surrounding try/catch and flashed the generic "could not be completed" error for an instant
  // before the navigation landed. Typing a label first also proves the second, separate bug: this
  // component remounts across that redirect round trip, so without restoring the typed label from
  // sessionStorage it would come back empty and have to be retyped.
  await page.getByLabel('Label (optional)').fill('MacBook Touch ID');

  // First click has no fresh step-up evidence yet, so it redirects to the authenticator challenge.
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  await expect(page.getByText('That could not be completed. Try again.')).toHaveCount(0);
  await page.getByLabel('Authenticator code').fill(await freshTotpCode(E2E_TOTP_SECRET));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/dashboard\/security$/);
  await expect(page.getByLabel('Label (optional)')).toHaveValue('MacBook Touch ID');

  // Second click now runs with fresh evidence and completes a real browser WebAuthn ceremony.
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('Passkey added.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('MacBook Touch ID')).toBeVisible();

  // Removal is its own sensitive action: the fresh step-up evidence registration just consumed
  // does not carry over, so this click needs its own authenticator challenge round too. Unlike
  // registration (a fresh WebAuthn ceremony must still follow, so a second click is unavoidable),
  // removal has nothing left to prove once the code is accepted -- it applies automatically, with
  // no second "Remove" click required.
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  await page.getByLabel('Authenticator code').fill(await freshTotpCode(E2E_TOTP_SECRET));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/dashboard\/security\?stepUpApplied=1$/);
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);

  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  await context.close();
});
