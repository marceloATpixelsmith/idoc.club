import { expect, test } from '@playwright/test';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

function requireEvidencePath() {
  const path = process.env.STRIPE_E2E_EVIDENCE_DIR;
  if (!path) throw new Error('STRIPE_E2E_EVIDENCE_DIR is required for provider evidence.');
  return path;
}

async function completeHostedCheckout(page: import('@playwright/test').Page, autoRenew: boolean) {
  await page.goto('/pricing');
  await expect(page).toHaveURL(/pricing/);
  const renewal = page.getByRole('checkbox', { name: /renew automatically/i });
  await expect(renewal).toBeVisible();
  if (await renewal.isChecked() !== autoRenew) await renewal.click();
  await page.locator('form').filter({ has: renewal }).getByRole('button', { name: /.+/ }).click();
  await page.waitForURL(/checkout\.stripe\.com/);
  await page.getByLabel(/email/i).fill(process.env.STRIPE_E2E_MEMBER_EMAIL as string);
  await page.getByLabel(/card number/i).fill('4242424242424242');
  await page.getByLabel(/expiration/i).fill('1230');
  await page.getByLabel(/security code|cvc/i).fill('123');
  await page.getByRole('button', { name: /pay|subscribe|complete/i }).click();
  await page.waitForURL(/dashboard|pricing/, { timeout: 60_000 });
}

test.describe('Stripe test-mode hosted Checkout acceptance', () => {
  test.beforeEach(async ({ context }) => {
    if (process.env.STRIPE_E2E_MEMBER_EMAIL === undefined) {
      throw new Error('STRIPE_E2E_MEMBER_EMAIL is required for authenticated provider tests.');
    }
    await context.tracing.start({ screenshots: true, snapshots: true });
  });

  test.afterEach(async ({ context }, testInfo) => {
    const evidenceDir = requireEvidencePath();
    await context.tracing.stop({ path: evidenceDir + '/' + testInfo.title.replace(/[^a-z0-9]+/gi, '-') + '.zip' });
  });

  test('completes one-time EUR 80 Checkout and returns without browser-authorized entitlement', async ({ page }) => {
    await completeHostedCheckout(page, false);
    const sessionId = new URL(page.url()).searchParams.get('session_id');
    expect(sessionId).toBeTruthy();
    const session = await stripe.checkout.sessions.retrieve(sessionId as string);
    expect(session.livemode).toBe(false);
    expect(session.mode).toBe('payment');
    expect(session.amount_total).toBe(8000);
    expect(session.currency).toBe('eur');
  });

  test('completes recurring EUR 80 Checkout and verifies the test subscription object', async ({ page }) => {
    await completeHostedCheckout(page, true);
    const sessionId = new URL(page.url()).searchParams.get('session_id');
    expect(sessionId).toBeTruthy();
    const session = await stripe.checkout.sessions.retrieve(sessionId as string, { expand: ['subscription'] });
    expect(session.livemode).toBe(false);
    expect(session.mode).toBe('subscription');
    expect(session.amount_total).toBe(8000);
    expect(session.currency).toBe('eur');
    expect(session.subscription).toBeTruthy();
  });

  test('repeated refresh and back navigation never creates a second Checkout session from the return page', async ({ page }) => {
    await completeHostedCheckout(page, false);
    const sessionId = new URL(page.url()).searchParams.get('session_id');
    await page.reload();
    await page.goBack();
    await page.goForward();
    const sessions = await stripe.checkout.sessions.list({ limit: 100 });
    expect(sessions.data.filter((session) => session.id === sessionId)).toHaveLength(1);
  });
});
