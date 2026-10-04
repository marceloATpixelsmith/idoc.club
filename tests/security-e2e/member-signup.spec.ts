import { expect, test } from '@playwright/test';
import {
  BREACHED_PASSWORD, authError, STRONG_PASSWORD, capturedMail, extractOtp, fillNewPassword, installTurnstileStub, mailCount,
  resetProviderControl, resetRateLimits, setProviderControl, signUpToPasswordStep, startSignupEmail, submitOtp,
  uniqueEmail, waitForMail, withDatabase,
  forgetSession,
} from './support/helpers';

// Email/password member signup, driven through the real UI against the real Next.js server and
// real Postgres. Turnstile, Brevo and HaveIBeenPwned are the only stand-ins (see
// tests/security-e2e/support/outbound-preload.cjs): the OTP below is the real code the app emailed.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await resetRateLimits();
  resetProviderControl();
  await installTurnstileStub(page);
});

async function accountFor(email: string) {
  return withDatabase(async (sql) => {
    const [user] = await sql<{ account_state: string; email_verified_at: Date | null; password_hash: string | null; role: string }[]>`
      select account_state, email_verified_at, password_hash, role from idoc.users where email = ${email}`;
    return user;
  });
}

test('LIVE-AUTH-001 a new member signs up with a real emailed code and lands in onboarding with a verified account', async ({ page }) => {
  const email = uniqueEmail('signup-journey');
  await signUpToPasswordStep(page, email);
  await fillNewPassword(page, STRONG_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const user = await accountFor(email);
  expect(user.account_state).toBe('onboarding');
  expect(user.role).toBe('member');
  expect(user.email_verified_at).not.toBeNull();
  expect(user.password_hash).toBeTruthy();
  expect(user.password_hash).not.toContain(STRONG_PASSWORD);

  // The new session is real: a protected API answers as the new member, and the session cookie is HttpOnly.
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === 'idoc-session')?.httpOnly).toBe(true);
});

test('LIVE-AUTH-001 the account created by signup can sign out and sign back in with its password', async ({ page }) => {
  const email = uniqueEmail('signup-then-login');
  await signUpToPasswordStep(page, email);
  await fillNewPassword(page, STRONG_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await forgetSession(page);
  await page.goto('/sign-in');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.locator('input[name="password"]').fill('Wrong-Password-1234!');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(authError(page)).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);

  // A browser with no remembered-device trust must also prove the mailbox: the correct password is
  // followed by a real emailed sign-in code before any session exists.
  const before = mailCount();
  await page.locator('input[name="password"]').fill(STRONG_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'idoc-session')).toBe(false);
  await submitOtp(page, extractOtp(await waitForMail(email, 'sign-in code', before)));
  await expect(page).toHaveURL(/\/dashboard/);
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'idoc-session')).toBe(true);
});

test('LIVE-AUTH-002 an incorrect emailed code is rejected without advancing, and the correct code then succeeds', async ({ page }) => {
  const email = uniqueEmail('signup-wrong-otp');
  const before = mailCount();
  await startSignupEmail(page, email);
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  const otp = extractOtp(await waitForMail(email, 'verification code', before));
  const wrong = otp === '000000' ? '111111' : '000000';
  await submitOtp(page, wrong);
  await expect(authError(page)).toContainText('incorrect');
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await page.reload();
  await submitOtp(page, otp);
  await expect(page.getByRole('heading', { name: 'Create your password' })).toBeVisible();
});

test('LIVE-AUTH-002 signing up with an existing account email sends no code and creates no second account', async ({ page }) => {
  const existing = 'member-a@security.example.test';
  const before = mailCount();
  await startSignupEmail(page, existing);
  // Outward behavior is neutral: the visitor is moved to the verify step exactly as for a new email.
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(capturedMail().slice(before).filter((mail) => mail.to === existing)).toHaveLength(0);
  const count = await withDatabase((sql) => sql`select count(*)::int as n from idoc.users where email = ${existing}`);
  expect(count[0].n).toBe(1);
});

test('LIVE-AUTH-021 a signup whose Turnstile challenge fails is rejected before any code is sent', async ({ page }) => {
  await page.unroute('https://challenges.cloudflare.com/**');
  await installTurnstileStub(page, { failing: true });
  const email = uniqueEmail('signup-turnstile-fail');
  const before = mailCount();
  await startSignupEmail(page, email);
  await expect(authError(page)).toContainText('Verification challenge failed');
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toHaveCount(0);
  expect(capturedMail().slice(before).filter((mail) => mail.to === email)).toHaveLength(0);
});

test('LIVE-AUTH-027 a transactional-email outage during signup fails closed with a safe message', async ({ page }) => {
  setProviderControl({ brevo: 'fail' });
  const email = uniqueEmail('signup-brevo-down');
  await startSignupEmail(page, email);
  await expect(authError(page)).toContainText('could not send');
  expect(await accountFor(email)).toBeUndefined();
});

test('LIVE-AUTH-034 password composition rules block a weak password client-side and nothing is created', async ({ page }) => {
  const email = uniqueEmail('signup-weak-password');
  await signUpToPasswordStep(page, email);
  await fillNewPassword(page, 'short');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await expect(page.getByLabel('Password requirements')).toBeVisible();
  expect(await accountFor(email)).toBeUndefined();
});

test('LIVE-AUTH-034 a password found in a public breach is rejected at signup, alerts operations without the password, and a clean password then succeeds', async ({ page }) => {
  const email = uniqueEmail('signup-breached');
  await signUpToPasswordStep(page, email);
  const before = mailCount();
  await fillNewPassword(page, BREACHED_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(authError(page)).toContainText('appeared in a public data breach');
  expect(await accountFor(email)).toBeUndefined();

  const alert = await waitForMail('ops-e2e@security.example.test', 'breached password rejected', before);
  expect(alert.html).toContain(email);
  expect(alert.html).toContain('account signup');
  expect(alert.html).not.toContain(BREACHED_PASSWORD);

  await fillNewPassword(page, STRONG_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  expect((await accountFor(email)).account_state).toBe('onboarding');
});

test('LIVE-AUTH-034 when the breach provider is unavailable signup fails open as documented (AUTH-PASSWORD-006)', async ({ page }) => {
  setProviderControl({ hibp: { mode: 'unavailable', passwords: [BREACHED_PASSWORD] } });
  const email = uniqueEmail('signup-hibp-down');
  await signUpToPasswordStep(page, email);
  await fillNewPassword(page, BREACHED_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  expect(await accountFor(email)).toBeDefined();
});
