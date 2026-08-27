import { expect, test } from '@playwright/test';

test('logout revokes the registry session so a copied cookie cannot be replayed', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.security-e2e/member-b.json' });
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page.getByText('Welcome, member-b Security Fixture.')).toBeVisible();
  const [oldCookie] = await context.cookies('http://127.0.0.1:3100');

  await page.getByRole('button').filter({ has: page.locator('[data-slot="avatar"]') }).click();
  await page.getByText('Sign out').click();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');

  const replay = await browser.newContext();
  await replay.addCookies([oldCookie]);
  const response = await replay.request.get('/api/user');
  expect(await response.json()).toBeNull();
  await replay.close();
  await context.close();
});
