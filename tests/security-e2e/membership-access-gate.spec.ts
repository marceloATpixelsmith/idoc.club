import { expect, test } from '@playwright/test';
import {
  STRONG_PASSWORD, authError, createActiveMember, extractOtp, forgetSession, installTurnstileStub, mailCount,
  resetProviderControl, resetRateLimits, setMembershipInDatabase, submitOtp, submitSignIn, uniqueEmail, waitForMail, withDatabase,
} from './support/helpers';

// What a signed-in member may see depends on their membership (docs/02):
//   - not paid yet, or lapsed: only the payment page; they sign out to see the public site;
//   - canceled (by the member or an administrator): full access until the end of the paid cycle, and
//     after that date the relationship is over and they cannot sign in.
// Next's dev server answers middleware redirects on `localhost`, so these journeys run there too and
// keep their host-only session cookies across the membership gate's redirects.
test.use({ baseURL: 'http://localhost:3100', storageState: { cookies: [], origins: [] } });

const PAYMENT_PAGE = /\/dashboard\/membership$/;
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

test.beforeEach(async ({ page }) => {
  await resetRateLimits();
  resetProviderControl();
  await installTurnstileStub(page);
});

async function hasSession(page: import('@playwright/test').Page) {
  return (await page.context().cookies()).some((cookie) => cookie.name === 'idoc-session');
}

test('a signed-in member who has not paid sees only the payment page, and signing out restores the public site', async ({ page }) => {
  const email = uniqueEmail('gate-unpaid');
  await createActiveMember(page, email);
  for (const route of ['/', '/seminars', '/about', '/news', '/contact', '/dashboard/profile', '/dashboard/security', '/admin']) {
    await page.goto(route);
    await expect(page, route).toHaveURL(PAYMENT_PAGE);
  }
  // Legal documents stay reachable (the onboarding consent text links to them).
  await page.goto('/terms');
  await expect(page).toHaveURL(/\/terms$/);
  await page.goto('/privacy');
  await expect(page).toHaveURL(/\/privacy$/);

  // Anything other than a GET to a gated page is refused outright.
  await page.goto('/dashboard/membership');
  const post = await page.request.post('/seminars', { data: 'x', headers: { origin: 'http://localhost:3100' } });
  expect(post.status()).toBe(403);

  await page.getByRole('button', { name: /menu/i }).first().click();
  await page.getByText('Sign out').click();
  await expect.poll(() => hasSession(page), { timeout: 15_000 }).toBe(false);
  await page.goto('/seminars');
  await expect(page).toHaveURL(/\/seminars$/);
});

test('a member whose membership lapsed can sign in but sees only the payment page', async ({ page }) => {
  const email = uniqueEmail('gate-lapsed');
  await createActiveMember(page, email);
  await setMembershipInDatabase(email, 'expired', '2025-12-31');
  await forgetSession(page);

  const before = mailCount();
  await submitSignIn(page, email, STRONG_PASSWORD);
  await submitOtp(page, extractOtp(await waitForMail(email, 'sign-in code', before)));
  await expect(page).toHaveURL(PAYMENT_PAGE);
  await page.goto('/seminars');
  await expect(page).toHaveURL(PAYMENT_PAGE);
});

test('a canceled membership keeps full access until the paid-through date and shows when it ends', async ({ page }) => {
  const email = uniqueEmail('gate-canceled-in-cycle');
  await createActiveMember(page, email);
  await setMembershipInDatabase(email, 'canceled', '2099-12-31');
  await page.goto('/seminars');
  await expect(page).toHaveURL(/\/seminars$/);
  await page.goto('/dashboard/security');
  await expect(page).toHaveURL(/\/dashboard\/security$/);
  await page.goto('/dashboard/membership');
  await expect(page.getByText(/Your membership has been canceled\. You keep full access until/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel membership' })).toHaveCount(0);
});

test('once a canceled membership passes its paid-through date the session ends and sign-in is refused', async ({ page }) => {
  const email = uniqueEmail('gate-canceled-ended');
  await createActiveMember(page, email);
  await setMembershipInDatabase(email, 'canceled', YESTERDAY);

  await page.goto('/seminars');
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await hasSession(page)).toBe(false);

  await submitSignIn(page, email, STRONG_PASSWORD);
  await expect(authError(page)).toContainText('This membership has been canceled');
  expect(await hasSession(page)).toBe(false);

  // The public site is open to them as a visitor, but there is no way back in.
  await page.goto('/seminars');
  await expect(page).toHaveURL(/\/seminars$/);
});

test('a member cancels from My Membership, keeps access to the end of the cycle, and is locked out once it ends', async ({ page }) => {
  const email = uniqueEmail('gate-self-cancel');
  await createActiveMember(page, email);
  await setMembershipInDatabase(email, 'active', '2099-12-31');
  await page.goto('/dashboard/membership');
  await page.getByRole('button', { name: 'Cancel membership' }).click();
  await page.getByRole('button', { name: 'Yes, cancel my membership' }).click();
  // The page's own note (not the dialog's description) appears only once the cancellation has been saved.
  await expect(page.getByText(/Your membership has been canceled\. You keep full access until/)).toBeVisible({ timeout: 20_000 });

  const row = await withDatabase(async (sql) => (await sql<{ status: string; valid_until: string }[]>`
    select m.status, m.valid_until::text as valid_until from idoc.memberships m join idoc.profiles p on p.id = m.profile_id
    join idoc.users u on u.id = p.user_id where u.email = ${email}`)[0]);
  expect(row).toEqual({ status: 'canceled', valid_until: '2099-12-31' });
  const audit = await withDatabase((sql) => sql`select count(*)::int as n from idoc.audit_log where action = 'member.membership_canceled'`);
  expect(audit[0].n).toBeGreaterThanOrEqual(1);

  // Still signed in, with full access, until the cycle ends.
  await page.goto('/seminars');
  await expect(page).toHaveURL(/\/seminars$/);

  await setMembershipInDatabase(email, 'canceled', YESTERDAY);
  await page.goto('/seminars');
  await expect(page).toHaveURL(/\/sign-in$/);
  await submitSignIn(page, email, STRONG_PASSWORD);
  await expect(authError(page)).toContainText('This membership has been canceled');
});
