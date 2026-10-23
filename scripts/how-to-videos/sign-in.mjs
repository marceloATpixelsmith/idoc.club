// Signs in as the DEMO member through the real /sign-in page and saves a Playwright storage-state file for record.mjs.
// Credentials come only from HOW_TO_DEMO_EMAIL / HOW_TO_DEMO_PASSWORD; nothing is printed or written except the cookies
// in the storage-state file, so keep that file out of the repo (use a temp or scratchpad path).
//
//   HOW_TO_BASE_URL=https://staging.idoc.club HOW_TO_DEMO_EMAIL=... HOW_TO_DEMO_PASSWORD=... \
//     node scripts/how-to-videos/sign-in.mjs <storage-state-file>
//
// Exit codes: 0 signed in, 1 failed, 2 an interactive challenge or MFA blocked sign-in (do not bypass it).
// If sign-in emails a 6-digit code, the script prints "CODE_REQUIRED" and waits for the digits to appear in the file
// named by HOW_TO_SIGN_IN_CODE_FILE (default: <storage-state-file>.code) for up to 10 minutes, then continues.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = (process.env.HOW_TO_BASE_URL ?? '').replace(/\/$/, '');
const email = process.env.HOW_TO_DEMO_EMAIL;
const password = process.env.HOW_TO_DEMO_PASSWORD;
const outFile = process.argv[2] ? resolve(process.argv[2]) : '';
if (!baseUrl || !email || !password || !outFile) {
  console.error('Set HOW_TO_BASE_URL, HOW_TO_DEMO_EMAIL and HOW_TO_DEMO_PASSWORD, and pass the storage-state output path.');
  process.exit(1);
}
const codeFile = resolve(process.env.HOW_TO_SIGN_IN_CODE_FILE ?? `${outFile}.code`);
mkdirSync(dirname(outFile), { recursive: true });
rmSync(codeFile, { force: true });

// Signed in means past the sign-in page and not parked on the MFA challenge, which is a blocked sign-in.
const leftSignIn = (url) => !url.pathname.startsWith('/sign-in') && !url.pathname.startsWith('/mfa');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitForCode() {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    if (existsSync(codeFile)) {
      const code = readFileSync(codeFile, 'utf8').replace(/\D/g, '');
      if (code.length === 6) return code;
    }
    await sleep(2000);
  }
  return null;
}

const browser = await chromium.launch({ executablePath: process.env.HOW_TO_CHROMIUM_PATH || undefined });
const context = await browser.newContext({ viewport: { height: 720, width: 1280 } });
const page = await context.newPage();
try {
  await page.goto(`${baseUrl}/sign-in`);
  await page.getByLabel('Email Address').fill(email);
  // Staging uses Cloudflare's always-pass Turnstile keys, so the widget verifies on its own and enables the button.
  const next = page.getByRole('button', { name: /sign in/i }).first();
  try {
    await next.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector('form button[type="submit"]')?.disabled, null, { timeout: 30_000 });
  } catch {
    console.error('BLOCKED: the sign-in button never became available (Turnstile challenge?). Not bypassing it.');
    process.exit(2);
  }
  await next.click();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in|log in|continue/i }).last().click();

  const outcome = await Promise.race([
    page.waitForURL(leftSignIn, { timeout: 45_000 }).then(() => 'signed-in'),
    page.waitForURL((url) => url.pathname.startsWith('/mfa'), { timeout: 45_000 }).then(() => 'mfa'),
    page.getByText(/6-digit code/i).waitFor({ timeout: 45_000 }).then(() => 'code'),
    page.getByText(/authenticator|recovery code/i).waitFor({ timeout: 45_000 }).then(() => 'mfa'),
  ]).catch(() => 'unknown');

  if (outcome === 'mfa') {
    console.error('BLOCKED: MFA is required for the demo member. Not bypassing it.');
    process.exit(2);
  }
  if (outcome === 'code') {
    console.log(`CODE_REQUIRED: write the 6-digit emailed code into ${codeFile}`);
    const code = await waitForCode();
    if (!code) {
      console.error('Timed out waiting for the sign-in code.');
      process.exit(1);
    }
    // The code field is a segmented OTP widget: focus it and type, so every slot receives a digit.
    await page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], [data-input-otp]').first().click();
    await page.keyboard.type(code, { delay: 80 });
    const verify = page.getByRole('button', { name: /verify|continue|submit/i }).first();
    if (await verify.isEnabled().catch(() => false)) await verify.click();
    try {
      await page.waitForURL(leftSignIn, { timeout: 45_000 });
    } catch {
      const message = await page.getByRole('alert').first().textContent().catch(() => '');
      console.error(`Code was not accepted${message ? `: ${message.trim()}` : ''} (still at ${new URL(page.url()).pathname}).`);
      process.exit(1);
    }
  } else if (outcome !== 'signed-in') {
    console.error(`Sign-in did not complete (ended at ${new URL(page.url()).pathname}).`);
    process.exit(1);
  }
  await context.storageState({ path: outFile });
  console.log(`signed in; storage state saved to ${outFile} (landed on ${new URL(page.url()).pathname})`);
} finally {
  rmSync(codeFile, { force: true });
  await browser.close();
}
