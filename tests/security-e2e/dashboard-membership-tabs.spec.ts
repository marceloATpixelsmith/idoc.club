import { expect, test } from '@playwright/test';

test('an entitled member sees the dashboard menu and My Membership shows status, no paywall', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'My Membership' })).toBeVisible();
  await expect(page.getByText('Pay for your IDOC membership')).toHaveCount(0);
  await expect(page.getByText('Type', { exact: true })).toBeVisible();
  await expect(page.getByText('Payment history')).toBeVisible();
  for (const label of ['My Profile', 'My Security']) {
    await expect(page.getByRole('link', { name: label })).toBeVisible();
  }
  await context.close();
});

test('the Payment Method box only appears for a member with a Stripe billing account', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Membership', exact: true })).toBeVisible();
  // member-a has no Stripe billing account in this fixture set -- only tests/stripe-e2e's
  // acceptance-matrix spec, backed by real Stripe test-mode data, covers the box's actual contents
  // (card on file, the Update Payment Method button). Here it must not render at all, never an
  // empty/broken box.
  await expect(page.getByRole('heading', { name: 'Payment Method' })).toHaveCount(0);
  await context.close();
});

test('the renewal mode explains what the selected mode means in plain language', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  const automaticRadio = page.getByRole('radio', { name: 'Automatic' });
  await expect(automaticRadio).toBeVisible();
  if (await automaticRadio.isChecked()) {
    await expect(page.getByText(/your membership will automatically renew on/i)).toBeVisible();
  } else {
    await expect(page.getByText(/your membership will expire on/i)).toBeVisible();
  }
  await context.close();
});

test('a not-yet-entitled member is sent straight to the pricing page, no intermediate paywall screen', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/expired.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('heading', { name: 'IDOC Membership' })).toBeVisible();
  await expect(page.getByText('Pay for your IDOC membership')).toHaveCount(0);
  // Dashboard routes remain gated; public website pages remain public and do not become dashboard routes.
  await page.goto('/dashboard/profile');
  await expect(page).toHaveURL(/\/pricing$/);
  await page.goto('/seminars');
  await expect(page).toHaveURL(/\/seminars$/);
  await expect(page.getByRole('heading', { name: 'My seminar registrations' })).toBeVisible();
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

test('an administrator with no member profile sees the dashboard menu and an honest "no profile" message, never the onboarding or paywall redirect', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/administrator-no-profile.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Pay for your IDOC membership')).toHaveCount(0);
  await expect(page.getByText('You have no member profile')).toBeVisible();
  for (const label of ['My Profile', 'My Security']) {
    await expect(page.getByRole('link', { name: label })).toBeVisible();
  }
  // Seminars is a public website page, not a dashboard tab.
  await page.goto('/seminars');
  await expect(page).toHaveURL(/\/seminars$/);
  await context.close();
});

test('My Profile merges the account email form with the professional profile form', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
  const page = await context.newPage();
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  // First/last name are the canonical name fields (docs/16) -- the redundant account-level "Name"
  // field was removed along with users.name, so account settings never maintain a second,
  // conflicting name value.
  await expect(page.getByLabel('First Name')).toBeVisible();
  await expect(page.getByLabel('Last Name')).toBeVisible();
  await expect(page.locator('label:has-text("Address 1")')).toBeVisible();
  await context.close();
});
