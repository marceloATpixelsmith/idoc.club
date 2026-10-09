import type { Page } from '@playwright/test';

/**
 * Pays on Stripe's hosted Checkout page with the 4242 test card. The page requires a cardholder name,
 * a postal code when the detected billing country has one (the sandbox geolocates to the US), and a
 * phone number while "Save my information" (Link) is ticked, so untick Link instead of enrolling a
 * fixture in it.
 */
export async function payWithTestCard(page: Page) {
  await page.getByLabel(/card number/i).fill('4242424242424242');
  await page.getByLabel(/expiration/i).fill('1230');
  await page.getByRole('textbox', { name: /cvc|security code/i }).fill('123');
  await page.getByRole('textbox', { name: /cardholder name/i }).fill('Stripe E2E');
  const postalCode = page.getByRole('textbox', { name: /^(zip|postal code|postcode)/i });
  if (await postalCode.isVisible()) await postalCode.fill('10001');
  const saveInformation = page.getByRole('checkbox', { name: /save my information/i });
  if (await saveInformation.isVisible() && await saveInformation.isChecked()) await saveInformation.uncheck();
  await page.getByTestId('hosted-payment-submit-button').click();
}
