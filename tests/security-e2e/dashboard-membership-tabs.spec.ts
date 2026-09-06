import { expect, test } from '@playwright/test';

test('an entitled member sees the full tab bar and My Membership shows status, no paywall', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'My Membership' })).toBeVisible();
  await expect(page.getByText('Pay for your IDOC membership')).toHaveCount(0);
  await expect(page.getByText(/^Type: /)).toBeVisible();
  await expect(page.getByText('Payment history')).toBeVisible();
  for (const label of ['My Profile', 'My Security', 'My Seminars']) {
    await expect(page.getByRole('link', { name: label })).toBeVisible();
  }
  await context.close();
});

test('a not-yet-entitled member sees only the paywall on every dashboard sub-page', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/expired.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page.getByText('Pay for your IDOC membership')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pay for membership' })).toBeVisible();
  // Only the My Membership tab itself is offered -- no other tab invites a click that would just
  // bounce back.
  for (const label of ['My Profile', 'My Security', 'My Seminars']) {
    await expect(page.getByRole('link', { name: label })).toHaveCount(0);
  }
  // A direct visit to any other dashboard sub-page (bookmark, typed URL) bounces back too -- this
  // is the actual enforcement, not just the hidden nav link.
  for (const route of ['/dashboard/profile', '/dashboard/seminars']) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Pay for your IDOC membership')).toBeVisible();
  }
  await context.close();
});

test('an administrator is never gated by membership payment status and can still reach dashboard security', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/administrator.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/security');
  await expect(page).toHaveURL(/\/dashboard\/security$/);
  await expect(page.getByText('Pay for your IDOC membership')).toHaveCount(0);
  await context.close();
});

test('My Profile merges the account name/email form with the professional profile form', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(page.locator('label:has-text("Address 1")')).toBeVisible();
  await context.close();
});
