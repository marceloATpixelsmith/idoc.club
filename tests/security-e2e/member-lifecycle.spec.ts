import { expect, test } from '@playwright/test';
import {
  STRONG_PASSWORD, chooseSeminarPaymentMethod, completeOnboardingWizard, fillNewPassword, insertSeminar, installStripeHostedPageStub,
  installTurnstileStub, mockStripeSessions, payMockStripeSession, registrationFor, resetProviderControl, resetRateLimits,
  signUpToPasswordStep, signedStripeEvent, uniqueEmail, withDatabase,
} from './support/helpers';

// One brand-new member carried through the whole paid journey in a real browser against the real
// app and Postgres: signup -> onboarding -> membership payment -> seminar registration -> seminar
// payment. Stripe is the only stand-in (tests/security-e2e/stripe-mock.ts); the app's real Stripe
// SDK, Checkout parameters, signature verification and webhook handlers all run. The Stripe-hosted
// payment page itself is covered separately by the opt-in test-mode suite (tests/stripe-e2e).
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

const email = uniqueEmail('lifecycle');
const MEMBER_SEMINAR = { capacity: 20, deadlineDays: 30, memberCents: 4500, nonMemberCents: 7000, title: 'E2E Lifecycle Member Seminar' };
const NON_MEMBER_SEMINAR = { capacity: 20, deadlineDays: 30, memberCents: 3000, nonMemberCents: 5500, title: 'E2E Lifecycle Non-Member Seminar' };
let memberSeminarId = 0;
let nonMemberSeminarId = 0;

async function profileRow() {
  return withDatabase(async (sql) => {
    const [row] = await sql<{ account_state: string; membership_status: string | null; profile_id: number | null; user_id: number }[]>`
      select u.id as user_id, u.account_state, p.id as profile_id, m.status as membership_status
      from idoc.users u left join idoc.profiles p on p.user_id = u.id
      left join idoc.memberships m on m.profile_id = p.id where u.email = ${email}`;
    return row;
  });
}

test.beforeAll(async () => {
  memberSeminarId = await insertSeminar(MEMBER_SEMINAR);
  nonMemberSeminarId = await insertSeminar(NON_MEMBER_SEMINAR);
});

test.beforeEach(async ({ page }) => {
  await resetRateLimits();
  resetProviderControl();
  await installTurnstileStub(page);
  await installStripeHostedPageStub(page);
});

test('1. the visitor signs up and lands in onboarding', async ({ page }) => {
  await signUpToPasswordStep(page, email);
  await fillNewPassword(page, STRONG_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'What kind of official are you?' })).toBeVisible();
  await page.context().storageState({ path: '.security-e2e/lifecycle-member.json' });
});

test.describe('after signup', () => {
  test.use({ storageState: '.security-e2e/lifecycle-member.json' });

  test('2. onboarding cannot be skipped by direct navigation, then completes and creates the profile', async ({ page }) => {
    await page.goto('/dashboard/membership');
    await expect(page).toHaveURL(/\/dashboard(\?|$)/);
    await expect(page.getByRole('heading', { name: 'What kind of official are you?' })).toBeVisible();
    expect((await profileRow()).profile_id).toBeNull();

    await completeOnboardingWizard(page);
    await expect(page).toHaveURL(/\/dashboard\/membership/, { timeout: 30_000 });
    const row = await profileRow();
    expect(row.account_state).toBe('active');
    expect(row.profile_id).not.toBeNull();
  });

  test('3. before paying for membership, the seminar shows both prices and offers registration', async ({ page }) => {
    await page.goto(`/seminars/${nonMemberSeminarId}`);
    await expect(page.getByText(/Members: .*30.* · Non-members: .*55/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Register/ })).toBeVisible();
    // The member-price registration is not available yet: the Seminars list tags nothing as registered.
    await page.goto('/seminars?view=my');
    await expect(page.locator('li', { hasText: NON_MEMBER_SEMINAR.title })).toHaveCount(0);
  });

  test('4. membership checkout is server-created at 80 EUR and returning from Stripe alone grants nothing', async ({ page }) => {
    await page.goto('/dashboard/membership');
    // Annual auto-renewal is the default: the same form makes a recurring yearly 80 EUR Session.
    await page.getByRole('button', { name: /Pay|Join|Renew|Checkout|Continue/i }).first().click();
    await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_e2e/);
    const recurring = (await mockStripeSessions()).find((candidate) => candidate.mode === 'subscription');
    expect(recurring?.amount_total).toBe(8000);
    expect((recurring as unknown as { line_items_price_data: { recurring: { interval: string } } }).line_items_price_data.recurring.interval).toBe('year');

    // Back out and choose the single 12-month payment instead.
    await page.goto('/dashboard/membership');
    await page.getByLabel(/Renew automatically/).uncheck();
    await page.getByRole('button', { name: /Pay|Join|Renew|Checkout|Continue/i }).first().click();
    await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_e2e/);

    const sessions = await mockStripeSessions();
    const session = sessions.find((candidate) => candidate.mode === 'payment' && candidate.metadata.profileId && !candidate.metadata.kind);
    expect(session, 'a membership Checkout Session was created').toBeDefined();
    expect(session?.amount_total).toBe(8000);
    expect(session?.currency).toBe('eur');

    // The success redirect is only a landing page: no entitlement without a verified webhook.
    await page.goto(`/api/stripe/checkout?session_id=${session?.id}`);
    expect((await profileRow()).membership_status).not.toBe('active');
  });

  test('5. a forged webhook is rejected and the verified one grants membership exactly once', async ({ page }) => {
    const sessions = await mockStripeSessions();
    const open = sessions.find((candidate) => candidate.mode === 'payment' && candidate.metadata.profileId && !candidate.metadata.kind);
    expect(open).toBeDefined();
    const paid = await payMockStripeSession(open?.id as string);

    const forged = signedStripeEvent('checkout.session.completed', paid);
    const rejected = await page.request.post('/api/stripe/webhook', { data: forged.payload, headers: { ...forged.headers, 'stripe-signature': 't=1,v1=deadbeef' } });
    expect(rejected.status()).toBe(400);
    expect((await profileRow()).membership_status).not.toBe('active');

    const verified = signedStripeEvent('checkout.session.completed', paid);
    expect((await page.request.post('/api/stripe/webhook', { data: verified.payload, headers: verified.headers })).status()).toBe(200);
    expect((await profileRow()).membership_status).toBe('active');

    // Stripe redelivers: the same event id must not double-credit.
    expect((await page.request.post('/api/stripe/webhook', { data: verified.payload, headers: verified.headers })).status()).toBe(200);
    const payments = await withDatabase((sql) => sql`select count(*)::int as n from idoc.payments where reference like ${`checkout_session:${paid.id}%`}`);
    expect(payments[0].n).toBe(1);
  });

  test('6. the now-entitled member registers at the member price and pays online', async ({ page }) => {
    await chooseSeminarPaymentMethod(page, memberSeminarId, /Online/);
    await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_e2e/);
    const session = (await mockStripeSessions()).find((candidate) => candidate.metadata.seminarId === String(memberSeminarId));
    expect(session?.amount_total).toBe(MEMBER_SEMINAR.memberCents);
    expect(await registrationFor(email, MEMBER_SEMINAR.title)).toMatchObject({ payment_status: 'pending', registration_status: 'registered' });
  });

  test('7. the verified seminar webhook marks the registration paid and My Seminars shows it', async ({ page }) => {
    const session = (await mockStripeSessions()).find((candidate) => candidate.metadata.seminarId === String(memberSeminarId));
    const paid = await payMockStripeSession(session?.id as string);
    const event = signedStripeEvent('checkout.session.completed', paid);
    expect((await page.request.post('/api/stripe/webhook', { data: event.payload, headers: event.headers })).status()).toBe(200);
    expect((await registrationFor(email, MEMBER_SEMINAR.title)).payment_status).toBe('paid');

    await page.goto('/seminars?view=my');
    await expect(page.locator('li', { hasText: MEMBER_SEMINAR.title })).toContainText('(paid)');
  });
});
