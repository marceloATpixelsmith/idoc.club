import { expect, test } from '@playwright/test';
import Stripe from 'stripe';

test('uses the configured active membership Product in Stripe test mode', async () => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
  const product = await stripe.products.retrieve(process.env.STRIPE_MEMBERSHIP_PRODUCT_ID as string);
  expect(product.active).toBe(true);
  expect(product.id).toBe(process.env.STRIPE_MEMBERSHIP_PRODUCT_ID);
  expect(product.livemode).toBe(false);
});

test('the reachable application exposes membership and seminar browser entry points', async ({ page }) => {
  const membership = await page.goto('/membership');
  expect(membership?.ok()).toBe(true);
  await expect(page.locator('body')).toContainText(/membership/i);

  const seminars = await page.goto('/seminars');
  expect(seminars?.ok()).toBe(true);
  await expect(page.locator('body')).toContainText(/seminar/i);
});

/*
 * The provider-backed acceptance matrix is deliberately maintained in docs/09. Individual flow
 * specs added here must use real Checkout/Portal pages and verified webhooks, while retaining only
 * redacted object IDs. No route interception or browser-owned identity/amount fixture can satisfy
 * an acceptance item. This prerequisite spec therefore fails before any flow when the account,
 * Product, disposable database, or application is unavailable; it never turns missing evidence
 * into a skipped or passing scenario.
 */
