import { expect, test } from '@playwright/test';
import Stripe from 'stripe';
import postgres from 'postgres';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const sql = postgres(process.env.TEST_DATABASE_URL as string, { max: 1 });

async function waitForProjection(expectedSource: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ source: string }[]>`select p.source from idoc.payments p
      join idoc.profiles pr on pr.id = p.profile_id
      join idoc.users u on u.id = pr.user_id
      where u.email = ${process.env.STRIPE_E2E_MEMBER_EMAIL}
      and p.source = ${expectedSource}
      limit 1`;
    if (rows.length === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('Timed out waiting for verified Stripe webhook projection.');
}

function evidencePath() {
  const value = process.env.STRIPE_E2E_EVIDENCE_DIR;
  if (!value) throw new Error('STRIPE_E2E_EVIDENCE_DIR is required.');
  return value;
}

async function completeHostedCheckout(page: import('@playwright/test').Page, autoRenew: boolean) {
  await page.goto('/pricing');
  const renewal = page.getByRole('checkbox', { name: /renew automatically/i });
  await expect(renewal).toBeVisible();
  if (await renewal.isChecked() !== autoRenew) await renewal.click();
  await page.locator('form').filter({ has: renewal }).getByRole('button').click();
  await page.waitForURL(/checkout\.stripe\.com/);
  const checkoutSessionId = page.url().match(/cs_[A-Za-z0-9_]+/)?.[0];
  expect(checkoutSessionId).toBeTruthy();
  await page.getByLabel(/card number/i).fill('4242424242424242');
  await page.getByLabel(/expiration/i).fill('1230');
  await page.getByLabel(/security code|cvc/i).fill('123');
  await page.getByRole('button', { name: /pay|subscribe|complete/i }).click();
  await page.waitForURL(/dashboard|pricing/, { timeout: 60_000 });
  return checkoutSessionId as string;
}

test.describe('Stripe test-mode hosted Checkout acceptance', () => {
  test.beforeEach(async ({ context }) => {
    if (!process.env.STRIPE_E2E_MEMBER_EMAIL) {
      throw new Error('STRIPE_E2E_MEMBER_EMAIL is required for authenticated provider tests.');
    }
    await context.tracing.start({ screenshots: true, snapshots: true });
  });

  test.afterEach(async ({ context }, info) => {
    await context.tracing.stop({ path: evidencePath() + '/' + info.title.replace(/[^a-z0-9]+/gi, '-') + '.zip' });
  });

  test('completes one-time EUR 80 Checkout and verifies the test-mode Session', async ({ page }) => {
    const sessionId = await completeHostedCheckout(page, false);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    expect(session.livemode).toBe(false);
    expect(session.mode).toBe('payment');
    expect(session.amount_total).toBe(8000);
    expect(session.currency).toBe('eur');
    await waitForProjection('stripe_one_time');
  });

  test('completes recurring EUR 80 Checkout and verifies the test-mode subscription', async ({ page }) => {
    const sessionId = await completeHostedCheckout(page, true);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    expect(session.livemode).toBe(false);
    expect(session.mode).toBe('subscription');
    expect(session.amount_total).toBe(8000);
    expect(session.currency).toBe('eur');
    expect(session.subscription).toBeTruthy();
    await waitForProjection('stripe_recurring');
  });

  test('refresh and back navigation do not create an additional Checkout Session', async ({ page }) => {
    const before = await stripe.checkout.sessions.list({ limit: 100 });
    const sessionId = await completeHostedCheckout(page, false);
    await page.reload();
    await page.goBack();
    await page.goForward();
    const after = await stripe.checkout.sessions.list({ limit: 100 });
    const newSessions = after.data.filter((session) => !before.data.some((old) => old.id === session.id));
    expect(newSessions.filter((session) => session.id === sessionId)).toHaveLength(1);
    expect(newSessions).toHaveLength(1);
  });
});
