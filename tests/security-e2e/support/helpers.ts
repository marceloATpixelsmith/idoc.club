import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import Stripe from 'stripe';
import { STRIPE_MOCK_URL } from '../stripe-mock';
import { E2E_BASE_URL, E2E_CONTROL_FILE, E2E_MAIL_SINK, E2E_STRIPE_WEBHOOK_SECRET } from './e2e-env';

export const STRONG_PASSWORD = 'Correct-Horse-Battery-9!';
/** Passes the composition policy (12+ chars, upper, lower, digit, symbol) but is registered as
 * "found in a public breach" through the HaveIBeenPwned stand-in, so only the breach check can
 * reject it. */
export const BREACHED_PASSWORD = 'Password123!Password';

export function database() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required.');
  return postgres(url, { max: 1, onnotice: () => {} });
}

export async function withDatabase<T>(work: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = database();
  try { return await work(sql); } finally { await sql.end(); }
}

/** Every browser request shares one origin ("unknown" outside Vercel), so the per-origin buckets
 * would otherwise be exhausted by the suite's own signups. Clearing them between tests is safe
 * because this database is disposable and test-only (validated by playwright.security.config.ts). */
export async function resetRateLimits() {
  await withDatabase((sql) => sql`truncate table idoc.account_request_limits`);
}

type Control = { brevo?: 'ok' | 'fail'; hibp?: { mode?: 'clean' | 'unavailable'; passwords?: string[] } };
export function setProviderControl(control: Control) {
  writeFileSync(E2E_CONTROL_FILE, JSON.stringify({ brevo: 'ok', hibp: { mode: 'clean', passwords: [BREACHED_PASSWORD] }, ...control }));
}
export function resetProviderControl() {
  setProviderControl({});
}

export type CapturedMail = { html: string; receivedAt: string; subject: string; to: string };
export function capturedMail(): CapturedMail[] {
  return readFileSync(E2E_MAIL_SINK, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as CapturedMail);
}

export async function waitForMail(to: string, subjectPart: RegExp | string, after = 0): Promise<CapturedMail> {
  const matches = (mail: CapturedMail) => mail.to.toLowerCase() === to.toLowerCase()
    && (typeof subjectPart === 'string' ? mail.subject.includes(subjectPart) : subjectPart.test(mail.subject));
  let found: CapturedMail | undefined;
  await expect.poll(() => {
    found = capturedMail().slice(after).find(matches);
    return Boolean(found);
  }, { message: `no captured email to ${to} with subject ${String(subjectPart)}`, timeout: 15_000 }).toBe(true);
  return found as CapturedMail;
}

export function mailCount() {
  return capturedMail().length;
}

export function extractOtp(mail: CapturedMail): string {
  const match = />\s*(\d{6})\s*</.exec(mail.html) ?? /\b(\d{6})\b/.exec(mail.html.replace(/<[^>]+>/g, ' '));
  if (!match) throw new Error(`No 6-digit code found in "${mail.subject}".`);
  return match[1];
}

export function uniqueEmail(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@security.example.test`;
}

/** Cloudflare's script is replaced in the browser with a stub that immediately reports a token the
 * server-side stand-in accepts only for the matching action (`e2e-pass:<action>`), so the app's
 * real hostname/action verification still executes. Pass `failing` to make the challenge produce a
 * token the server must reject. */
export async function installTurnstileStub(page: Page, options: { failing?: boolean } = {}) {
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.turnstile={render:function(el,o){setTimeout(function(){o.callback(${options.failing ? "'e2e-fail'" : "'e2e-pass:'+o.action"})},0);return 'e2e-widget'},reset:function(){},remove:function(){}};`,
  }));
}

export async function startSignupEmail(page: Page, email: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Sign up' }).click();
}

export async function submitOtp(page: Page, code: string) {
  await page.locator('input[name="code"]').fill(code);
  // Signup/reset submit themselves on the sixth digit; sign-in has an extra "Remember me" choice, so
  // it waits for an explicit Verify click.
  if (await page.getByLabel(/Remember me/).count()) await page.getByRole('button', { name: 'Verify' }).click();
}

export async function fillNewPassword(page: Page, password: string) {
  await page.locator('input[name="password"]').fill(password);
}

/** Drives signup to the password-creation step with a real emailed code. */
export async function signUpToPasswordStep(page: Page, email: string) {
  const before = mailCount();
  await startSignupEmail(page, email);
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  const otp = extractOtp(await waitForMail(email, /verif|code/i, before));
  await submitOtp(page, otp);
  await expect(page.getByRole('heading', { name: 'Create your password' })).toBeVisible();
}

/** The form's own error paragraph. `getByRole('alert')` is ambiguous because Next.js also renders a
 * route-announcer element with role=alert. */
export function authError(page: Page) {
  return page.locator('.idoc-auth-error');
}

/** Completes the real onboarding wizard for a veterinarian (the shortest classification: no
 * federation/region/official-status fields). */
export async function completeOnboardingWizard(page: Page, names = { first: 'Ada', last: 'Lovelace' }) {
  await page.getByRole('button', { name: /^Veterinarian/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('First name').fill(names.first);
  await page.getByLabel('Last name').fill(names.last);
  await fillPhone(page, 'input#phone');
  await page.locator('select#countryCode').selectOption('DE');
  await page.locator('input#address1').fill('1 Test Road');
  await page.locator('input#city').fill('Berlin');
  await page.locator('input#stateProvince').fill('Berlin');
  await page.locator('input#postalCode').fill('10115');
  await page.locator('input[name="termsAccepted"]').check();
  await page.locator('input[name="privacyAccepted"]').check();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
}

export type MockStripeSession = {
  amount_total: number; currency: string; customer: string; id: string; metadata: Record<string, string>; mode: string;
  payment_intent: string | null; payment_status: string; status: string; url: string;
};

export async function mockStripeSessions(): Promise<MockStripeSession[]> {
  return (await fetch(`${STRIPE_MOCK_URL}/__control/sessions`)).json() as Promise<MockStripeSession[]>;
}

/** The shopper completes the hosted payment page. Returns the now-paid Checkout Session. */
export async function payMockStripeSession(id: string, shopperEntries: Record<string, unknown> = {}): Promise<MockStripeSession> {
  const response = await fetch(`${STRIPE_MOCK_URL}/__control/pay/${id}`, { body: JSON.stringify(shopperEntries), method: 'POST' });
  if (!response.ok) throw new Error(`mock Stripe could not complete ${id}`);
  return response.json() as Promise<MockStripeSession>;
}

/** Stripe's own SDK signs the test webhook with the same secret the app verifies against, so the
 * app's real constructEvent signature check runs. */
export function signedStripeEvent(type: string, object: unknown, eventId = `evt_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`) {
  const payload = JSON.stringify({ api_version: '2025-08-27.basil', created: Math.floor(Date.now() / 1000), data: { object }, id: eventId, livemode: false, object: 'event', type });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: E2E_STRIPE_WEBHOOK_SECRET });
  return { eventId, headers: { 'content-type': 'application/json', origin: E2E_BASE_URL, 'stripe-signature': signature }, payload };
}

/** Stands in for the Stripe-hosted payment page in the browser. */
export async function installStripeHostedPageStub(page: Page) {
  await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Stripe Checkout (e2e stand-in)</title><h1 id="stripe-standin">Stripe hosted payment page</h1>',
  }));
}

/** A fully onboarded, signed-in member created through the real signup and onboarding UI. */
export async function createActiveMember(page: Page, email: string, password = STRONG_PASSWORD) {
  await signUpToPasswordStep(page, email);
  await fillNewPassword(page, password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await completeOnboardingWizard(page);
  // The dev server compiles /dashboard/membership on first use, which can exceed the default timeout.
  await expect(page).toHaveURL(/\/dashboard\/membership/, { timeout: 30_000 });
}

/** Drives /recover-password to the new-password step with a real emailed code. */
export async function recoverToPasswordStep(page: Page, email: string) {
  const before = mailCount();
  await page.goto('/recover-password');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: /Send|Continue|Reset|Recover/i }).first().click();
  await submitOtp(page, extractOtp(await waitForMail(email, 'password reset code', before)));
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
}

/** Gives an onboarded member an active membership directly in the database, for specs whose subject
 * is not payment (the paid path is exercised end to end in member-lifecycle.spec.ts). */
export async function grantMembershipInDatabase(email: string) {
  await withDatabase(async (sql) => {
    const [profile] = await sql<{ id: number }[]>`
      select p.id from idoc.profiles p join idoc.users u on u.id = p.user_id where u.email = ${email}`;
    await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source)
      values (${profile.id}, 'active', '2025-01-01', '2099-12-31', 'migration')`;
  });
}

/** Signs the browser out of everything it holds. Navigating away first cancels in-flight requests:
 * the app refreshes the session cookie on activity, so a late response could otherwise re-set
 * `idoc-session` immediately after clearCookies(). */
export async function forgetSession(page: Page) {
  await page.goto('about:blank');
  await page.context().clearCookies();
}

export function hasSessionCookie(cookies: { name: string }[]) {
  return cookies.some((cookie) => cookie.name === 'idoc-session');
}

export type SeminarFixture = { capacity: number; deadlineDays: number; memberCents: number; nonMemberCents: number; title: string };

/** Publishes a seminar directly in the database (administrator authoring is covered elsewhere). */
export async function insertSeminar(seminar: SeminarFixture): Promise<number> {
  return withDatabase(async (sql) => {
    const [admin] = await sql<{ id: number }[]>`select id from idoc.users where email = 'administrator@security.example.test'`;
    // A Playwright retry re-runs the setup against the same database, so clear anything from the first attempt.
    await sql`delete from idoc.seminar_registrations where seminar_id in (select id from idoc.seminars where title = ${seminar.title})`;
    await sql`delete from idoc.seminars where title = ${seminar.title}`;
    const [row] = await sql<{ id: number }[]>`insert into idoc.seminars
      (title, description, start_date, end_date, location, language, capacity, member_price_cents, non_member_price_cents,
       registration_deadline, status, created_by_user_id, updated_by_user_id)
      values (${seminar.title}, 'Playwright seminar', current_date + 90, current_date + 90, 'Vienna', 'en', ${seminar.capacity},
        ${seminar.memberCents}, ${seminar.nonMemberCents}, now() + (${seminar.deadlineDays} * interval '1 day'), 'published', ${admin.id}, ${admin.id})
      returning id`;
    return row.id;
  });
}

/** Opens a seminar's detail page, presses Register and, for a visitor with a profile, chooses the
 * payment method in the dialog. */
export async function chooseSeminarPaymentMethod(page: Page, seminarId: number, methodLabel: string | RegExp) {
  await page.goto(`/seminars/${seminarId}`);
  const register = page.getByRole('button', { name: /^Register/ });
  const dialog = page.getByRole('dialog', { name: 'Choose a payment method' });
  // In Next.js development mode the server-rendered button can be clicked before
  // React hydration attaches its handler. Wait for the actual dialog, not a
  // payment button inside a dialog that never opened.
  await expect(async () => {
    if (!(await dialog.isVisible())) await register.click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000, intervals: [500, 1000, 1500] });
  await dialog.getByRole('button', { name: methodLabel }).click();
}

export async function registrationFor(email: string, title: string) {
  return withDatabase(async (sql) => (await sql<{ expected_amount_cents: number | null; payment_status: string; registration_status: string }[]>`
    select r.expected_amount_cents, r.payment_status, r.registration_status from idoc.seminar_registrations r
    join idoc.seminars s on s.id = r.seminar_id
    left join idoc.profiles p on p.id = r.profile_id left join idoc.users u on u.id = p.user_id
    where s.title = ${title} and (lower(u.email) = lower(${email}) or lower(r.guest_email) = lower(${email}))`)[0]);
}

/** The international phone control: pick a calling code from the country list, then type the number. */
export async function fillPhone(page: Page, numberInputSelector: string, scope: Page | ReturnType<Page['locator']> = page) {
  await scope.getByRole('button', { name: 'Choose phone country' }).click();
  await scope.getByLabel('Search countries').fill('+49');
  await scope.getByRole('option').first().click();
  await scope.locator(numberInputSelector).fill('301234567');
}

/** Rewrites an onboarded member's latest membership row (status and paid-through date). */
export async function setMembershipInDatabase(email: string, status: string, validUntil: string) {
  await withDatabase(async (sql) => {
    const [profile] = await sql<{ id: number }[]>`
      select p.id from idoc.profiles p join idoc.users u on u.id = p.user_id where u.email = ${email}`;
    const updated = await sql`update idoc.memberships set status = ${status}, valid_until = ${validUntil}, updated_at = now()
      where profile_id = ${profile.id}`;
    if (updated.count === 0) {
      await sql`insert into idoc.memberships(profile_id, status, starts_on, valid_until, source)
        values (${profile.id}, ${status}, '2025-01-01', ${validUntil}, 'migration')`;
    }
  });
}

/** Password sign-in from a signed-out browser, up to the first answer the server gives. */
export async function submitSignIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.locator('input[name="password"]').fill(password);
  const answered = page.waitForResponse((response) => response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await answered;
}
