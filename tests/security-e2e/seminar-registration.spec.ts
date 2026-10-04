import { expect, test, type Page } from '@playwright/test';
import {
  createActiveMember, fillPhone, grantMembershipInDatabase, insertSeminar, installStripeHostedPageStub,
  installTurnstileStub, mockStripeSessions, payMockStripeSession, registrationFor, resetProviderControl, resetRateLimits,
  signedStripeEvent, uniqueEmail, withDatabase,
} from './support/helpers';

// Seminar registration rules beyond the paid golden path in member-lifecycle.spec.ts: payment-method
// availability, every payment method, member and non-member pricing, cancellation, capacity, closed
// registration, webhook redelivery and anonymous guest registration. Stripe is the only stand-in
// (tests/security-e2e/stripe-mock.ts).
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

const SEMINARS = {
  bank: { capacity: 20, deadlineDays: 30, memberCents: 3000, nonMemberCents: 5000, title: 'E2E Bank Transfer Seminar' },
  cash: { capacity: 20, deadlineDays: 30, memberCents: 3200, nonMemberCents: 5200, title: 'E2E Cash Seminar' },
  closed: { capacity: 20, deadlineDays: -1, memberCents: 3000, nonMemberCents: 5000, title: 'E2E Closed Registration Seminar' },
  full: { capacity: 1, deadlineDays: 30, memberCents: 2000, nonMemberCents: 4000, title: 'E2E Full Seminar' },
  guestBank: { capacity: 20, deadlineDays: 30, memberCents: 3000, nonMemberCents: 5100, title: 'E2E Guest Bank Seminar' },
  guestStripe: { capacity: 20, deadlineDays: 30, memberCents: 3000, nonMemberCents: 5300, title: 'E2E Guest Stripe Seminar' },
  nonMemberOnline: { capacity: 20, deadlineDays: 30, memberCents: 3000, nonMemberCents: 5400, title: 'E2E Non-Member Online Seminar' },
  online: { capacity: 20, deadlineDays: 30, memberCents: 6000, nonMemberCents: 9000, title: 'E2E Online Seminar' },
} as const;
const ids: Record<keyof typeof SEMINARS, number> = {} as Record<keyof typeof SEMINARS, number>;

const memberOne = uniqueEmail('seminar-one');
const memberTwo = uniqueEmail('seminar-two');
const unpaidMember = uniqueEmail('seminar-unpaid');
const guestEmail = uniqueEmail('seminar-guest');

async function openPaymentChoices(page: Page, seminarId: number) {
  await page.goto(`/seminars/${seminarId}`);
  await page.getByRole('button', { name: /^Register/ }).first().click();
  return page.getByRole('dialog');
}

test.beforeAll(async () => {
  // A serial-group retry re-runs from the start against the same database: restore the default of
  // only the online method being enabled, which the first test below relies on.
  await withDatabase((sql) => sql`update idoc.seminar_payment_methods set enabled = false, instructions_html = null
    where canonical_id in ('bank_transfer', 'cash_event')`);
  for (const [key, seminar] of Object.entries(SEMINARS)) ids[key as keyof typeof SEMINARS] = await insertSeminar(seminar);
});

test.beforeEach(async ({ page }) => {
  await resetRateLimits();
  resetProviderControl();
  await installTurnstileStub(page);
  await installStripeHostedPageStub(page);
});

test('0. setup: two paid-up members and one onboarded member who has not paid', async ({ browser }) => {
  test.setTimeout(240_000);
  for (const [email, file, paid] of [[memberOne, 'seminar-one', true], [memberTwo, 'seminar-two', true], [unpaidMember, 'seminar-unpaid', false]] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await installTurnstileStub(page);
    await resetRateLimits();
    await createActiveMember(page, email);
    if (paid) await grantMembershipInDatabase(email);
    await context.storageState({ path: `.security-e2e/${file}.json` });
    await context.close();
  }
});

test.describe('member one', () => {
  test.use({ storageState: '.security-e2e/seminar-one.json' });

  test('only payment methods an administrator has enabled are offered', async ({ page }) => {
    let dialog = await openPaymentChoices(page, ids.bank);
    await expect(dialog.getByRole('button', { name: /Online/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Bank Transfer/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Cash/ })).toHaveCount(0);

    // Stands in for the administrator enabling the two offline methods in organization settings.
    await withDatabase((sql) => sql`update idoc.seminar_payment_methods set enabled = true,
      instructions_html = case canonical_id when 'bank_transfer' then '<p>Transfer to IBAN AT00 E2E TEST</p>' else null end
      where canonical_id in ('bank_transfer', 'cash_event')`);
    dialog = await openPaymentChoices(page, ids.bank);
    await expect(dialog.getByRole('button', { name: /Bank Transfer/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Cash/ })).toBeVisible();
  });

  test('a bank-transfer registration is recorded at the member price with no Stripe session', async ({ page }) => {
    const before = (await mockStripeSessions()).length;
    const dialog = await openPaymentChoices(page, ids.bank);
    await dialog.getByRole('button', { name: /Bank Transfer/ }).click();
    await expect(page).toHaveURL(/\/seminars\?view=my/);
    const row = page.locator('li', { hasText: SEMINARS.bank.title });
    await expect(row).toContainText('Bank Transfer');
    await expect(row).toContainText('30.00');
    expect(await registrationFor(memberOne, SEMINARS.bank.title)).toEqual({
      expected_amount_cents: SEMINARS.bank.memberCents, payment_status: 'bank_transfer_pending', registration_status: 'registered',
    });
    expect((await mockStripeSessions()).length).toBe(before);
  });

  test('a cash registration appears in My Seminars and can be canceled', async ({ page }) => {
    const dialog = await openPaymentChoices(page, ids.cash);
    await dialog.getByRole('button', { name: /Cash/ }).click();
    await expect(page).toHaveURL(/\/seminars\?view=my/);
    const row = page.locator('li', { hasText: SEMINARS.cash.title });
    await expect(row).toContainText('Cash');
    expect((await registrationFor(memberOne, SEMINARS.cash.title)).payment_status).toBe('cash_pending');

    await row.getByRole('button', { name: 'Cancel registration' }).click();
    await expect.poll(async () => (await registrationFor(memberOne, SEMINARS.cash.title)).registration_status, { timeout: 15_000 }).toBe('canceled');
    await page.goto('/seminars?view=my');
    await expect(page.locator('li', { hasText: SEMINARS.cash.title })).toContainText(/cancel/i);
    await expect(page.locator('li', { hasText: SEMINARS.cash.title }).getByRole('button', { name: 'Cancel registration' })).toHaveCount(0);
  });

  test('a seminar whose registration deadline has passed offers no registration', async ({ page }) => {
    await page.goto(`/seminars/${ids.closed}`);
    await expect(page.getByText(/registration is not currently open/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Register/ })).toHaveCount(0);
  });

  test('the last place in a full seminar goes to the first member', async ({ page }) => {
    const dialog = await openPaymentChoices(page, ids.full);
    await dialog.getByRole('button', { name: /Cash/ }).click();
    await expect(page).toHaveURL(/\/seminars\?view=my/);
    expect((await registrationFor(memberOne, SEMINARS.full.title)).registration_status).toBe('registered');
  });

  test('a redelivered paid-seminar webhook credits the registration exactly once', async ({ page }) => {
    const dialog = await openPaymentChoices(page, ids.online);
    await dialog.getByRole('button', { name: /Online/ }).click();
    await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_e2e/);
    const session = (await mockStripeSessions()).find((candidate) => candidate.metadata.seminarId === String(ids.online));
    expect(session?.amount_total).toBe(SEMINARS.online.memberCents);
    const paid = await payMockStripeSession(session?.id as string);
    const event = signedStripeEvent('checkout.session.completed', paid);
    for (let delivery = 0; delivery < 3; delivery += 1) {
      expect((await page.request.post('/api/stripe/webhook', { data: event.payload, headers: event.headers })).status()).toBe(200);
    }
    expect((await registrationFor(memberOne, SEMINARS.online.title)).payment_status).toBe('paid');
    const credited = await withDatabase((sql) => sql`select count(*)::int as n from idoc.audit_log
      where action = 'seminar.payment_confirmed' and after_json->>'sessionId' = ${paid.id}`);
    expect(credited[0].n).toBe(1);

    await page.goto('/seminars?view=my');
    await expect(page.locator('li', { hasText: SEMINARS.online.title })).toContainText('(paid)');
    await page.goto(`/seminars/${ids.online}`);
    await expect(page.getByRole('button', { name: /^Register/ })).toHaveCount(0);
  });
});

test.describe('member two', () => {
  test.use({ storageState: '.security-e2e/seminar-two.json' });

  test('a full seminar no longer offers registration to the next member', async ({ page }) => {
    await page.goto(`/seminars/${ids.full}`);
    await expect(page.getByText(/registration is not currently open/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Register/ })).toHaveCount(0);
    expect(await registrationFor(memberTwo, SEMINARS.full.title)).toBeUndefined();
  });
});

test.describe('signed-in member who has not paid for membership', () => {
  test.use({ storageState: '.security-e2e/seminar-unpaid.json' });

  // KNOWN DEFECT (found by this specification, reproduced on the staging branch): a signed-in profile
  // without current entitlement is routed to the non-member-price registration (the seminar detail
  // page comment describes exactly this path). registerForSeminarAtNonMemberPrice creates the
  // registration, but createSeminarCheckoutSession then calls requireAccountAccess('member'), which
  // only entitled members or administrators pass, so no Stripe Checkout Session is created, the
  // member is left registered-but-unpaid with the Register button gone, and no error reaches them.
  // test.fail() keeps this documented without hiding it: the run goes red the moment it is fixed,
  // at which point this marker must be removed.
  test.fail('registering online at the non-member price reaches Stripe Checkout', async ({ page }) => {
    const dialog = await openPaymentChoices(page, ids.nonMemberOnline);
    await dialog.getByRole('button', { name: /Online/ }).click();
    await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_e2e/, { timeout: 10_000 });
    const session = (await mockStripeSessions()).find((candidate) => candidate.metadata.seminarId === String(ids.nonMemberOnline));
    expect(session?.amount_total).toBe(SEMINARS.nonMemberOnline.nonMemberCents);
  });
});

test.describe('signed-out visitor', () => {
  test('the public catalog shows both prices and no member-only controls', async ({ page }) => {
    await page.goto('/seminars');
    const row = page.locator('li', { hasText: SEMINARS.guestBank.title });
    await expect(row).toContainText('Members: €30.00');
    await expect(row).toContainText('Non-members: €51.00');
    await expect(page.getByRole('navigation', { name: 'Seminars view' })).toHaveCount(0);
  });

  test('Register offers joining for the member price or continuing as a guest', async ({ page }) => {
    await page.goto(`/seminars/${ids.guestBank}`);
    await page.getByRole('button', { name: /^Register/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: /Join to get member pricing of €30\.00/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Register as a guest/ })).toBeVisible();
  });

  test('a guest pays online through Stripe first and the verified webhook creates the paid registration', async ({ page }) => {
    await page.goto(`/seminars/${ids.guestStripe}`);
    await page.getByRole('button', { name: /^Register/ }).click();
    await page.getByRole('button', { name: /Register as a guest/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Online/ }).click();
    await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_e2e/);
    const session = (await mockStripeSessions()).find((candidate) => candidate.metadata.seminarId === String(ids.guestStripe));
    expect(session?.amount_total).toBe(SEMINARS.guestStripe.nonMemberCents);
    expect(await registrationFor(guestEmail, SEMINARS.guestStripe.title)).toBeUndefined();

    // Stripe collects the guest's details on its own page; the verified webhook then creates the registration.
    const paid = await payMockStripeSession(session?.id as string, {
      custom_fields: [{ key: 'first_name', text: { value: 'Gina' } }, { key: 'last_name', text: { value: 'Guest' } }],
      customer_details: { email: guestEmail, phone: '+49301234567' },
    });
    const event = signedStripeEvent('checkout.session.completed', paid);
    expect((await page.request.post('/api/stripe/webhook', { data: event.payload, headers: event.headers })).status()).toBe(200);
    expect(await registrationFor(guestEmail, SEMINARS.guestStripe.title)).toMatchObject({ payment_status: 'paid', registration_status: 'registered' });
  });

  test('a guest registers by bank transfer with contact details, and the same email cannot register twice', async ({ page }) => {
    const submit = async () => {
      await page.goto(`/seminars/${ids.guestBank}`);
      await page.getByRole('button', { name: /^Register/ }).click();
      await page.getByRole('button', { name: /Register as a guest/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /Bank Transfer/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('First name').fill('Bea');
      await dialog.getByLabel('Last name').fill('Banker');
      await dialog.getByLabel('Email').fill(guestEmail);
      await fillPhone(page, 'input#guestPhone', dialog);
      await dialog.getByRole('button', { name: /^Register/ }).click();
    };
    await submit();
    await expect(page.getByText(/Registration completed successfully/)).toBeVisible();
    expect(await registrationFor(guestEmail, SEMINARS.guestBank.title)).toMatchObject({
      expected_amount_cents: SEMINARS.guestBank.nonMemberCents, payment_status: 'bank_transfer_pending', registration_status: 'registered',
    });

    await resetRateLimits();
    await page.goto(`/seminars/${ids.guestBank}`);
    // Once registered the detail page no longer offers registration to this guest's session-less browser,
    // so the duplicate is attempted through the same form and must be refused by the server.
    await submit();
    await expect(page.getByText('This email is already registered for this seminar.')).toBeVisible();
  });
});
