import { expect, test } from '@playwright/test';
import {
  STRONG_PASSWORD, authError, createActiveMember, extractOtp, installTurnstileStub, mailCount, resetProviderControl,
  resetRateLimits, submitOtp, uniqueEmail, waitForMail,
  forgetSession, hasSessionCookie,
} from './support/helpers';

// Email/password sign-in negatives and device trust, against the real app. Brevo's mailbox is
// captured, so the sign-in code used below is the real one the app emailed.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await resetRateLimits();
  resetProviderControl();
  await installTurnstileStub(page);
});

async function startSignIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('input[name="password"]')).toBeVisible();
}

async function submitPassword(page: import('@playwright/test').Page, password: string) {
  await page.locator('input[name="password"]').fill(password);
  // Wait for the Server Action's response so a following read never sees the previous attempt's error.
  const answered = page.waitForResponse((response) => response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await answered;
}

test('LIVE-AUTH-003 an unknown email and a wrong password produce the same message (no account enumeration)', async ({ page }) => {
  const email = uniqueEmail('signin-enumeration');
  await createActiveMember(page, email);
  await forgetSession(page);

  await startSignIn(page, email);
  await submitPassword(page, 'Wrong-Password-1234!');
  await expect(authError(page)).toBeVisible();
  const knownAccountMessage = await authError(page).innerText();

  await forgetSession(page);
  await startSignIn(page, uniqueEmail('signin-nobody'));
  await submitPassword(page, 'Wrong-Password-1234!');
  await expect(authError(page)).toBeVisible();
  expect(await authError(page).innerText()).toBe(knownAccountMessage);
});

test('LIVE-AUTH-020 repeated wrong passwords are throttled and the correct password is then refused until the window recovers', async ({ page }) => {
  const email = uniqueEmail('signin-throttle');
  await createActiveMember(page, email);
  await forgetSession(page);
  await startSignIn(page, email);

  // The identifier bucket allows 8 wrong passwords per window, so the 9th must be throttled.
  for (let attempt = 0; attempt < 9; attempt += 1) {
    await submitPassword(page, `Wrong-Password-${attempt}-xyz!`);
    // The form is reset when the action settles; wait for that before the next attempt.
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled();
  }
  await expect(authError(page)).toContainText(/too many attempts/i);

  const before = mailCount();
  await submitPassword(page, STRONG_PASSWORD);
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled();
  await expect(authError(page)).toContainText(/too many attempts/i);
  expect(hasSessionCookie(await page.context().cookies())).toBe(false);
  expect(mailCount()).toBe(before);

  // Clearing the bucket stands in for the 15-minute window elapsing.
  await resetRateLimits();
  await submitPassword(page, STRONG_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
});

test('LIVE-AUTH-012 "Remember me" skips the emailed code on the next password sign-in from this browser only', async ({ browser, page }) => {
  const email = uniqueEmail('signin-remembered');
  await createActiveMember(page, email);
  await forgetSession(page);

  const before = mailCount();
  await startSignIn(page, email);
  await submitPassword(page, STRONG_PASSWORD);
  await page.locator('input[name="code"]').fill(extractOtp(await waitForMail(email, 'sign-in code', before)));
  await page.getByLabel(/Remember me/).check();
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:3100\/$/);

  // Same browser, session removed but the device-trust cookie kept: password alone signs in.
  const trusted = (await page.context().cookies()).filter((cookie) => cookie.name !== 'idoc-session');
  await forgetSession(page);
  await page.context().addCookies(trusted);
  const afterTrust = mailCount();
  await startSignIn(page, email);
  await submitPassword(page, STRONG_PASSWORD);
  await expect(page).toHaveURL(/127\.0\.0\.1:3100\/$/);
  expect(mailCount()).toBe(afterTrust);

  // A different browser has no device trust and is asked for a fresh code.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await installTurnstileStub(otherPage);
  await startSignIn(otherPage, email);
  await submitPassword(otherPage, STRONG_PASSWORD);
  await expect(otherPage.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await other.close();
});
