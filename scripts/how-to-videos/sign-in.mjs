// Signs in as the demo member through the real sign-in page and saves a Playwright storage-state file, so record.mjs
// never needs a hand-made one. Credentials come only from HOW_TO_DEMO_EMAIL / HOW_TO_DEMO_PASSWORD and are never printed.
//
//   HOW_TO_BASE_URL=https://staging.idoc.club node scripts/how-to-videos/sign-in.mjs <storage-state-path>
//
// This does not defeat Turnstile, MFA or the emailed sign-in code. If any of them appears the script exits with a
// distinct status and says which one, so a person can intervene (exit 3 = Turnstile never produced a token,
// 4 = emailed 6-digit code requested, 5 = MFA challenge, 6 = rejected credentials or unknown state).
import { chromium } from '@playwright/test';

export async function signInDemoMember({ baseUrl, email, password, storageStatePath }) {
  const browser = await chromium.launch(process.env.HOW_TO_CHROMIUM_PATH ? { executablePath: process.env.HOW_TO_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { height: 720, width: 1280 } });
  const page = await context.newPage();
  const fail = async (code, message) => {
    await browser.close();
    console.error(message);
    process.exit(code);
  };
  try {
    await page.goto(`${baseUrl}/sign-in`);
    await page.getByLabel('Email Address').fill(email);
    const submit = page.getByRole('button', { name: 'Sign In' });
    try {
      await submit.waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === 'Sign In');
        return Boolean(button) && !button.disabled;
      }, undefined, { timeout: 30_000 });
    } catch {
      await fail(3, 'Turnstile did not verify in the automated browser; the Sign In button stayed disabled. Not bypassing it.');
    }
    await submit.click();
    const password_ = page.getByLabel('Password', { exact: true });
    const otp = page.getByText(/6-digit|verification code|enter the code/i);
    const mfa = page.getByText(/authenticator|two-factor|recovery code/i);
    const outcome = await Promise.race([
      password_.waitFor({ timeout: 30_000 }).then(() => 'password'),
      otp.first().waitFor({ timeout: 30_000 }).then(() => 'otp'),
      page.waitForURL((url) => url.pathname.startsWith('/mfa'), { timeout: 30_000 }).then(() => 'mfa'),
    ]).catch(() => 'unknown');
    if (outcome === 'otp') await fail(4, 'The sign-in sent an emailed code. Provide it to a person-assisted run; not continuing.');
    if (outcome === 'mfa') await fail(5, 'An MFA challenge was requested. Not bypassing it.');
    if (outcome !== 'password') await fail(6, `Sign-in stopped at an unexpected step (${page.url()}).`);
    await password_.fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    // After the password the app either leaves /sign-in (signed in, or /mfa), re-renders /sign-in with the emailed-code
    // step, or shows an error. Wait for whichever comes first so each one is classified correctly.
    const afterPassword = await Promise.race([
      page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 }).then(() => 'left'),
      page.getByText(/6-digit|Verify your email/i).first().waitFor({ timeout: 30_000 }).then(() => 'otp'),
      page.getByRole('alert').first().waitFor({ timeout: 30_000 }).then(() => 'error'),
    ]).catch(() => 'unknown');
    if (afterPassword === 'otp') await fail(4, 'The sign-in sent an emailed code. Provide it to a person-assisted run; not continuing.');
    if (new URL(page.url()).pathname.startsWith('/mfa')) await fail(5, 'An MFA challenge was requested. Not bypassing it.');
    if (new URL(page.url()).pathname.startsWith('/sign-in')) {
      const alert = await page.getByRole('alert').first().textContent().catch(() => '');
      await fail(6, `Sign-in did not complete${alert ? `: ${alert.trim()}` : ''}.`);
    }
    await context.storageState({ path: storageStatePath });
    console.log(`signed in; landed on ${new URL(page.url()).pathname}`);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = (process.env.HOW_TO_BASE_URL ?? '').replace(/\/$/, '');
  const { HOW_TO_DEMO_EMAIL: email, HOW_TO_DEMO_PASSWORD: password } = process.env;
  const storageStatePath = process.argv[2];
  if (!baseUrl || !email || !password || !storageStatePath) {
    console.error('Set HOW_TO_BASE_URL, HOW_TO_DEMO_EMAIL, HOW_TO_DEMO_PASSWORD and pass the storage-state output path.');
    process.exit(1);
  }
  await signInDemoMember({ baseUrl, email, password, storageStatePath });
}
