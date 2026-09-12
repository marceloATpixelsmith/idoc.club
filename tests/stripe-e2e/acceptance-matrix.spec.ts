import { expect, test } from '@playwright/test';
import postgres from 'postgres';

const sql = postgres(process.env.TEST_DATABASE_URL as string, { max: 1 });
const memberEmail = process.env.STRIPE_E2E_MEMBER_EMAIL as string;

function evidencePath() {
  const value = process.env.STRIPE_E2E_EVIDENCE_DIR;
  if (!value) throw new Error('STRIPE_E2E_EVIDENCE_DIR is required.');
  return value;
}

test.describe('Stripe acceptance matrix beyond hosted Checkout', () => {
  test('opens a server-created Customer Portal session without accepting a client Customer ID', async ({ page }) => {
    await page.goto('/dashboard');
    const manage = page.getByRole('button', { name: /manage payment method/i }).or(
      page.getByRole('button', { name: /customer portal/i }),
    );
    await expect(manage).toBeVisible();
    await manage.click();
    await page.waitForURL(/billing\.stripe\.com|customer\.stripe\.com/);
    expect(page.url()).not.toContain('customer=');
    expect(page.url()).not.toContain('profileId=');
  });

  test('shows authoritative paid-through and renewal state after returning to the dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText(/paid through:/i)).toBeVisible();
    await expect(page.getByText(/current renewal mode:/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /turn on automatic renewal|turn off automatic renewal|cancel pending change/i })).toBeVisible();
    const rows = await sql`select e.valid_until from idoc.membership_entitlements e
      join idoc.profiles p on p.id=e.profile_id join idoc.users u on u.id=p.user_id
      where u.email=${memberEmail} order by e.id desc limit 1`;
    expect(rows).toHaveLength(1);
    expect(String(rows[0].valid_until)).not.toBe('');
  });

  test('keeps seminar checkout prices isolated to the selected seminar', async ({ page }) => {
    await page.goto('/seminars?view=available');
    await expect(page.getByRole('heading', { name: /seminars & courses/i })).toBeVisible();

    const cards = page.locator('section[aria-labelledby="available-seminars-heading"] li');
    await expect(cards).toHaveCount(2);
    const prices = await cards.locator('p').filter({ hasText: /€|No fee/ }).allTextContents();
    expect(prices.map((price) => price.trim())).toEqual(expect.arrayContaining(['€50.00', '€75.00']));
    const registrationButtons = page.getByRole('button', { name: /register/i });
    await expect(registrationButtons).toHaveCount(2);
  });

  test('rejects a member from accessing administrator refund controls', async ({ page }) => {
    const response = await page.goto('/admin/payments');
    expect(response?.status()).toBeGreaterThanOrEqual(300);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('body')).not.toContainText(/approve full refund|refund seminar registration/i);
  });

  test('refresh and back do not duplicate portal sessions or local payment projections', async ({ page }) => {
    await page.goto('/dashboard');
    const manage = page.getByRole('button', { name: /manage payment method/i });
    await expect(manage).toBeVisible();
    await manage.click();
    await page.waitForURL(/billing\\.stripe\\.com|customer\\.stripe\\.com/);
    await page.goBack();
    const paymentCount = await sql`select count(*)::int as count from idoc.payments p
      join idoc.profiles pr on pr.id=p.profile_id join idoc.users u on u.id=pr.user_id
      where u.email=${memberEmail}`;
    await page.reload();
    await page.goBack();
    await page.goForward();
    const paymentCountAfter = await sql`select count(*)::int as count from idoc.payments p
      join idoc.profiles pr on pr.id=p.profile_id join idoc.users u on u.id=pr.user_id
      where u.email=${memberEmail}`;
    expect(paymentCountAfter[0].count).toBe(paymentCount[0].count);
  });
});
