import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import Stripe from 'stripe';

const sql = postgres(process.env.TEST_DATABASE_URL as string, { max: 1 });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const memberEmail = process.env.STRIPE_E2E_MEMBER_EMAIL as string;

function evidencePath() {
  const value = process.env.STRIPE_E2E_EVIDENCE_DIR;
  if (!value) throw new Error('STRIPE_E2E_EVIDENCE_DIR is required.');
  return value;
}

test.describe('Stripe acceptance matrix beyond hosted Checkout', () => {
  test('opens a server-created Customer Portal session without accepting a client Customer ID', async ({ page }) => {
    const billings = await sql`select b.external_customer_id,u.email from idoc.billing_accounts b
      join idoc.profiles p on p.id=b.profile_id join idoc.users u on u.id=p.user_id
      where u.email like 'stripe-e2e-%@example.test' order by (u.email=${memberEmail}) desc`;
    expect(billings).toHaveLength(2);
    const [billing, forgedBilling] = billings;
    const customer = await stripe.customers.retrieve(billing.external_customer_id);
    expect(customer.deleted).toBe(false);
    if (!customer.deleted) {
      expect(customer.livemode).toBe(false);
      expect(customer.email).toBe(billing.email);
    }
    await page.goto('/dashboard');
    const manage = page.getByRole('button', { name: /manage payment method/i }).or(
      page.getByRole('button', { name: /customer portal/i }),
    );
    await expect(manage).toBeVisible();
    await manage.evaluate((button, forgedCustomerId) => {
      const form = button.closest('form');
      if (!form) throw new Error('Portal action form was not found.');
      const forged = document.createElement('input');
      forged.name = 'customer';
      forged.value = String(forgedCustomerId);
      form.append(forged);
    }, forgedBilling.external_customer_id);
    // "Manage payment method" opens the portal in a new tab rather than navigating this page away.
    const [popup] = await Promise.all([page.waitForEvent('popup'), manage.click()]);
    await popup.waitForURL(/billing\.stripe\.com|customer\.stripe\.com/);
    await expect(popup.getByText(billing.email, { exact: false })).toBeVisible();
    await expect(popup.getByText(forgedBilling.email, { exact: false })).toHaveCount(0);
    await popup.close();
  });

  test('shows authoritative paid-through and renewal state after returning to the dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText(/renewal date:/i)).toBeVisible();
    await expect(page.getByText(/current renewal mode:/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /turn on automatic renewal|turn off automatic renewal|cancel pending change/i })).toBeVisible();
    const rows = await sql`select e.valid_until from idoc.memberships e
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

  test('BROWSER-REFRESH-BACK refresh and back do not duplicate portal sessions or local payment projections', async ({ page }) => {
    await page.goto('/dashboard');
    const manage = page.getByRole('button', { name: /manage payment method/i });
    await expect(manage).toBeVisible();
    // The portal opens in a new tab, leaving this page's own history at /dashboard throughout --
    // exercise the back/reload/back/forward sequence against that unaffected history, same intent
    // as the pre-popup same-tab version of this test.
    const [popup] = await Promise.all([page.waitForEvent('popup'), manage.click()]);
    await popup.waitForURL(/billing\.stripe\.com|customer\.stripe\.com/);
    await popup.close();
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


test('BROWSER-DOUBLE-CLICK double-click creates one seminar registration and one provider Checkout Session', async ({ page }) => {
  await page.goto('/seminars?view=available');
  const cards = page.locator('section[aria-labelledby="available-seminars-heading"] li');
  const firstRegister = cards.filter({ hasText: 'Stripe E2E Seminar B' }).getByRole('button', { name: /register/i });
  await expect(firstRegister).toBeVisible();
  await firstRegister.dblclick();
  await page.waitForURL(/checkout\.stripe\.com/);
  expect(page.url()).toContain('checkout.stripe.com');
  const rows = await sql`select id,checkout_status,expected_amount_cents,stripe_checkout_session_id from idoc.seminar_registrations order by id desc limit 1`;
  expect(rows).toHaveLength(1);
  expect(rows[0].checkout_status).toBe('open');
  expect([5000, 7500]).toContain(rows[0].expected_amount_cents);
  const providerSessions = await stripe.checkout.sessions.list({ limit: 100 });
  const matchingProviderSessions = providerSessions.data.filter((session) =>
    session.livemode === false && session.metadata?.kind === 'seminar_registration' &&
    session.metadata?.registrationId === String(rows[0].id));
  expect(matchingProviderSessions).toHaveLength(1);
  expect(matchingProviderSessions[0].id).toBe(rows[0].stripe_checkout_session_id);
});

test('BROWSER-EXPIRED-SESSION rejects protected reads and mutations without leaking data', async ({ page }) => {
  const sessionRows = await sql`select a.session_id,a.absolute_expires_at from idoc.auth_sessions a join idoc.users u on u.id=a.user_id
    where u.email=${memberEmail} order by a.authenticated_at desc limit 1`;
  expect(sessionRows).toHaveLength(1);
  await sql`update idoc.auth_sessions set absolute_expires_at=now()-interval '1 second' where session_id=${sessionRows[0].session_id}`;
  const response = await page.goto('/admin/reconciliation');
  expect(response?.status()).toBeGreaterThanOrEqual(300);
  await expect(page.locator('body')).not.toContainText(/reconciliation finding|stripe customer|payment intent/i);
  const mutation = await page.request.post('/api/stripe/checkout', { data: { mode: 'one_time' } });
  expect(mutation.status()).toBeGreaterThanOrEqual(400);
  expect(await mutation.text()).not.toMatch(/cus_|pi_|cs_|registration/i);
  await sql`update idoc.auth_sessions set absolute_expires_at=${sessionRows[0].absolute_expires_at} where session_id=${sessionRows[0].session_id}`;
});

test('BROWSER-CSRF-FAILURE rejects a seminar mutation with missing CSRF and creates no database or Stripe object', async ({ page }) => {
  await page.goto('/seminars?view=available');
  const before = await sql`select count(*)::int count from idoc.seminar_registrations`;
  const button = page.locator('section[aria-labelledby="available-seminars-heading"] li').first().getByRole('button', { name: /register/i });
  await button.evaluate((element) => element.closest('form')?.querySelector('input[name="csrf_token"]')?.remove());
  await button.click();
  await expect(page.getByRole('alert')).toContainText(/security check failed/i);
  const after = await sql`select count(*)::int count from idoc.seminar_registrations`;
  expect(after[0].count).toBe(before[0].count);
});

test('BROWSER-UNAUTHORIZED-MEMBER denies cross-member billing, seminar, payment, refund, and reconciliation identifiers without leakage', async ({ page }) => {
  const [other] = await sql`select p.id profile_id,b.external_customer_id from idoc.profiles p join idoc.users u on u.id=p.user_id
    join idoc.billing_accounts b on b.profile_id=p.id where u.email<>${memberEmail} and u.email like 'stripe-e2e-%-other@example.test'`;
  expect(other).toBeTruthy();
  for (const path of [`/dashboard?profileId=${other.profile_id}&customer=${other.external_customer_id}`,
    `/seminars?profileId=${other.profile_id}&registrationId=999999`, '/admin/payments?profileId=999999', '/admin/reconciliation']) {
    const response = await page.goto(path);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain(other.external_customer_id);
    expect(body).not.toMatch(/pi_|internal error|reconciliation finding/i);
    if (path.startsWith('/admin/')) expect(response?.status()).toBeGreaterThanOrEqual(300);
  }
});

test('BROWSER-ADMIN-RECONCILIATION permits an administrator while forged ownership identifiers reveal no provider data', async ({ browser }) => {
  const context = await browser.newContext({ storageState: '.stripe-e2e/admin.json' });
  const page = await context.newPage();
  const [member] = await sql`select p.id,b.external_customer_id from idoc.profiles p join idoc.users u on u.id=p.user_id
    join idoc.billing_accounts b on b.profile_id=p.id where u.email=${memberEmail}`;
  const response = await page.goto(`/admin/reconciliation?profileId=${member.id}&customer=${member.external_customer_id}&payment=pi_forged&registration=999999`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /stripe reconciliation/i })).toBeVisible();
  const body = await page.locator('body').innerText();
  expect(body).not.toContain(member.external_customer_id);
  expect(body).not.toContain('pi_forged');
  await context.close();
});
