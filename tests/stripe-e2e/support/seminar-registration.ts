import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Seminar registration happens on the seminar's own page: open it from the available list, press
 * "Register", and the payment-method dialog offers "Online via Stripe". Returns that button; its form
 * carries the hidden `csrf_token`, `seminarId` and `paymentMethod` inputs.
 */
export async function openSeminarRegistration(page: Page, title: string): Promise<Locator> {
  await page.goto('/seminars?view=available');
  const card = page.locator('section[aria-labelledby="available-seminars-heading"] li').filter({ hasText: title });
  await card.getByRole('link').first().click();
  await page.waitForURL(/\/seminars\/\d+/);
  await page.getByRole('button', { name: /^register/i }).click();
  const stripeButton = page.getByRole('dialog').getByRole('button', { name: /online via stripe/i });
  await expect(stripeButton).toBeVisible();
  return stripeButton;
}
