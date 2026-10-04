import { expect, test } from '@playwright/test';
import {
  BREACHED_PASSWORD, STRONG_PASSWORD, authError, createActiveMember, extractOtp, fillNewPassword, grantMembershipInDatabase, installTurnstileStub,
  mailCount, recoverToPasswordStep, resetProviderControl, resetRateLimits, setProviderControl, submitOtp, uniqueEmail,
  waitForMail, withDatabase,
  forgetSession,
} from './support/helpers';

// Password reset and password change against the real app. HaveIBeenPwned is the only stand-in; the
// emailed reset code is the real one the app generated.
test.use({ storageState: { cookies: [], origins: [] } });

const NEW_PASSWORD = 'Another-Strong-Pass-42!';

test.beforeEach(async ({ page }) => {
  await resetRateLimits();
  resetProviderControl();
  await installTurnstileStub(page);
});

async function passwordHashFor(email: string) {
  return withDatabase(async (sql) => (await sql<{ password_hash: string }[]>`select password_hash from idoc.users where email = ${email}`)[0].password_hash);
}

test('LIVE-AUTH-015 password reset: a breached new password is rejected and alerts operations, then a clean one replaces the credential', async ({ page }) => {
  const email = uniqueEmail('reset-breached');
  await createActiveMember(page, email);
  await forgetSession(page);
  const originalHash = await passwordHashFor(email);

  await recoverToPasswordStep(page, email);
  const before = mailCount();
  await fillNewPassword(page, BREACHED_PASSWORD);
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await expect(authError(page)).toContainText('appeared in a public data breach');
  expect(await passwordHashFor(email)).toBe(originalHash);
  const alert = await waitForMail('ops-e2e@security.example.test', 'breached password rejected', before);
  expect(alert.html).toContain('a password reset');
  expect(alert.html).not.toContain(BREACHED_PASSWORD);

  await fillNewPassword(page, NEW_PASSWORD);
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await expect(page.getByText('Your password was reset. Sign in with your new password.')).toBeVisible();
  expect(await passwordHashFor(email)).not.toBe(originalHash);
});

test('LIVE-AUTH-015 after a reset the old password no longer works and the new one does', async ({ page }) => {
  const email = uniqueEmail('reset-replaces');
  await createActiveMember(page, email);
  await forgetSession(page);
  await recoverToPasswordStep(page, email);
  await fillNewPassword(page, NEW_PASSWORD);
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await expect(page.getByText('Your password was reset. Sign in with your new password.')).toBeVisible();

  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.locator('input[name="password"]').fill(STRONG_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(authError(page)).toContainText('Invalid email or password');

  const before = mailCount();
  await page.locator('input[name="password"]').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await submitOtp(page, extractOtp(await waitForMail(email, 'sign-in code', before)));
  // A fully set-up account lands on the homepage after sign-in.
  await expect(page).toHaveURL(/127\.0\.0\.1:3100\/$/);
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'idoc-session')).toBe(true);
});

test('LIVE-AUTH-015 a password-reset request for an unknown email looks identical and sends no code', async ({ page }) => {
  const email = uniqueEmail('reset-unknown');
  const before = mailCount();
  await page.goto('/recover-password');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: /Send|Continue|Reset|Recover/i }).first().click();
  await expect(page.getByLabel('Email Address')).toHaveCount(0);
  await page.waitForTimeout(1500);
  const { capturedMail } = await import('./support/helpers');
  expect(capturedMail().slice(before).filter((mail) => mail.to === email)).toHaveLength(0);
});

test('LIVE-AUTH-034 password reset fails open when the breach provider is unavailable', async ({ page }) => {
  const email = uniqueEmail('reset-hibp-down');
  await createActiveMember(page, email);
  await forgetSession(page);
  setProviderControl({ hibp: { mode: 'unavailable', passwords: [BREACHED_PASSWORD] } });
  await recoverToPasswordStep(page, email);
  await fillNewPassword(page, BREACHED_PASSWORD);
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await expect(page.getByText('Your password was reset. Sign in with your new password.')).toBeVisible();
});

test.describe('password change from the Security page', () => {
  async function openPasswordCard(page: import('@playwright/test').Page, email: string) {
    await createActiveMember(page, email);
    await grantMembershipInDatabase(email);
    await page.goto('/dashboard/security');
    await expect(page.getByRole('heading', { name: 'Security Settings' })).toBeVisible();
  }

  test('LIVE-AUTH-007 an onboarded member without a paid membership is bounced from Security settings to the paywall', async ({ page }) => {
    await createActiveMember(page, uniqueEmail('change-unpaid'));
    await page.goto('/dashboard/security');
    await expect(page).toHaveURL(/\/dashboard(\/membership)?$/);
    await expect(page.getByRole('heading', { name: 'Security Settings' })).toHaveCount(0);
  });

  test('LIVE-AUTH-014 a wrong current password is rejected', async ({ page }) => {
    await openPasswordCard(page, uniqueEmail('change-wrong-current'));
    await page.locator('input#current-password').fill('Not-The-Current-1!x');
    await page.locator('input#new-password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Update Password' }).click();
    await expect(page.getByText('Current password is incorrect.')).toBeVisible();
  });

  test('LIVE-AUTH-034 a breached new password is rejected and alerts operations; a clean one signs the member out everywhere', async ({ page }) => {
    const email = uniqueEmail('change-breached');
    await openPasswordCard(page, email);
    const originalHash = await passwordHashFor(email);
    const before = mailCount();
    await page.locator('input#current-password').fill(STRONG_PASSWORD);
    await page.locator('input#new-password').fill(BREACHED_PASSWORD);
    await page.getByRole('button', { name: 'Update Password' }).click();
    await expect(page.getByText('appeared in a public data breach')).toBeVisible();
    expect(await passwordHashFor(email)).toBe(originalHash);
    const alert = await waitForMail('ops-e2e@security.example.test', 'breached password rejected', before);
    expect(alert.html).toContain('a self-service password change');
    expect(alert.html).not.toContain(BREACHED_PASSWORD);

    // The form is cleared after a rejected submit, so both fields are entered again.
    await page.locator('input#current-password').fill(STRONG_PASSWORD);
    await page.locator('input#new-password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Update Password' }).click();
    await expect(page.getByText('Your password was changed. Sign in again on every device.')).toBeVisible({ timeout: 20_000 });
    expect(await passwordHashFor(email)).not.toBe(originalHash);
    await page.goto('/dashboard/security');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
