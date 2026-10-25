import { expect, test } from '@playwright/test';
import {
  installControllableTurnstile, resetRateLimits, turnstileEvent, turnstileRenderCount, uniqueEmail,
} from './support/helpers';

// The widget's behavior against a Cloudflare that is NOT the immediate-pass stub every other spec
// uses. A production visitor whom Cloudflare challenges, or whose widget never yields a token, gets
// exactly these paths -- and a hidden widget there leaves Sign In disabled with nothing on screen. The
// stub plays Cloudflare's callbacks by hand (see installControllableTurnstile), and the clock is
// faked so the 12-second, three-attempt token watchdog can be exercised without waiting 36 seconds.
test.use({ baseURL: 'http://localhost:3100', storageState: { cookies: [], origins: [] } });

const WATCHDOG_MS = 12_000;
const WATCHDOG_ATTEMPTS = 3;
const ALERT = /security check didn.t load/i;

test.beforeEach(async ({ page }) => {
  await resetRateLimits();
  await installControllableTurnstile(page);
});

async function openSignIn(page: import('@playwright/test').Page) {
  await page.clock.install();
  await page.goto('/sign-in');
  await expect.poll(() => turnstileRenderCount(page)).toBe(1);
}

const wrapper = (page: import('@playwright/test').Page) => page.locator('.idoc-auth-turnstile');
const signIn = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Sign In' });

test('a silent pass keeps the widget hidden and enables Sign In once an email is typed', async ({ page }) => {
  await openSignIn(page);
  await page.getByLabel('Email Address').fill(uniqueEmail('turnstile-silent'));
  await expect(signIn(page)).toBeDisabled();
  await turnstileEvent(page, 'solve');
  await expect(signIn(page)).toBeEnabled();
  await expect(wrapper(page)).toHaveAttribute('data-challenge-visible', 'false');
});

test('an interactive challenge Cloudflare announces is shown even when no iframe is detectable, and solving it signs the visitor through', async ({ page }) => {
  await openSignIn(page);
  await page.getByLabel('Email Address').fill(uniqueEmail('turnstile-interactive'));

  // Cloudflare says it needs the visitor; the DOM contains nothing the fallback detector could find.
  await turnstileEvent(page, 'before-interactive-callback');
  await expect(wrapper(page)).toHaveAttribute('data-challenge-visible', 'true');
  expect((await wrapper(page).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(60);
  await expect(signIn(page)).toBeDisabled();

  await turnstileEvent(page, 'after-interactive-callback');
  await turnstileEvent(page, 'solve');
  await expect(signIn(page)).toBeEnabled();
  // The token is real as far as the server is concerned: submitting reaches the password step.
  await signIn(page).click();
  await expect(page.locator('input[name="password"]')).toBeVisible();
});

test('a challenge the visitor is solving is never flagged as failed, however long it takes', async ({ page }) => {
  await openSignIn(page);
  await turnstileEvent(page, 'before-interactive-callback');
  await page.clock.runFor(WATCHDOG_MS * (WATCHDOG_ATTEMPTS + 2));
  await expect(page.getByRole('alert').filter({ hasText: ALERT })).toHaveCount(0);
  await expect(wrapper(page)).toHaveAttribute('data-challenge-visible', 'true');
});

test('a widget that never produces a token surfaces the retry message instead of staying hidden, and "try again" re-arms the watchdog', async ({ page }) => {
  await openSignIn(page);
  await page.getByLabel('Email Address').fill(uniqueEmail('turnstile-stalled'));
  await expect(page.getByRole('alert').filter({ hasText: ALERT })).toHaveCount(0);

  await page.clock.runFor(WATCHDOG_MS * (WATCHDOG_ATTEMPTS + 1));
  await expect(page.getByRole('alert').filter({ hasText: ALERT })).toBeVisible();
  await expect(signIn(page)).toBeDisabled();
  expect(await turnstileRenderCount(page)).toBe(WATCHDOG_ATTEMPTS);

  // Retrying re-renders and clears the message, and a second stall must surface it again.
  const rendersBeforeRetry = await turnstileRenderCount(page);
  await page.getByRole('button', { name: 'try again' }).click();
  await expect.poll(() => turnstileRenderCount(page)).toBe(rendersBeforeRetry + 1);
  await expect(page.getByRole('alert').filter({ hasText: ALERT })).toHaveCount(0);
  await page.clock.runFor(WATCHDOG_MS * (WATCHDOG_ATTEMPTS + 1));
  await expect(page.getByRole('alert').filter({ hasText: ALERT })).toBeVisible();

  // A token finally arriving clears the message and enables Sign In.
  await turnstileEvent(page, 'solve');
  await expect(page.getByRole('alert').filter({ hasText: ALERT })).toHaveCount(0);
  await expect(signIn(page)).toBeEnabled();
});

test('a browser Cloudflare reports as unsupported, or a render error, shows the retry message immediately', async ({ page }) => {
  await openSignIn(page);
  await turnstileEvent(page, 'unsupported-callback');
  await expect(page.getByRole('alert').filter({ hasText: ALERT })).toBeVisible();

  await page.getByRole('button', { name: 'try again' }).click();
  await expect(page.getByRole('alert').filter({ hasText: ALERT })).toHaveCount(0);
  await turnstileEvent(page, 'error-callback');
  await expect(page.getByRole('alert').filter({ hasText: ALERT })).toBeVisible();
});
