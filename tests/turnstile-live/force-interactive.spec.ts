import { expect, test } from '@playwright/test';

// Real Cloudflare script, real widget, Cloudflare's published "force an interactive challenge" test
// key (see playwright.turnstile-live.config.ts). This is the user-visible contract the stubbed suite
// cannot prove: when Cloudflare really does need the visitor, the challenge is on screen with room to
// be seen and clicked, Sign In stays disabled until it is solved, and solving it enables Sign In.
//
// Cloudflare draws the challenge where neither querySelectorAll('iframe') nor Playwright selectors can
// reach it (an empty light-DOM host), which is exactly why the widget must rely on Cloudflare's own
// before-interactive callback rather than looking for an iframe. So this test asserts on the wrapper's
// size and clicks by position instead of locating Cloudflare's checkbox element.
test('a real forced interactive challenge is visible, blocks Sign In until solved, and solving it enables Sign In', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email Address').fill('turnstile-live@security.example.test');

  const wrapper = page.locator('.idoc-auth-turnstile');
  await expect(wrapper).toHaveAttribute('data-challenge-visible', 'true', { timeout: 30_000 });
  await expect.poll(async () => (await wrapper.boundingBox())?.height ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(60);
  expect((await wrapper.boundingBox())?.width ?? 0).toBeGreaterThan(100);
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeDisabled();

  // Cloudflare's "Verify you are human" checkbox sits at the left edge, vertically centred.
  const box = (await wrapper.boundingBox())!;
  await page.mouse.click(box.x + 21, box.y + Math.min(box.height, 65) / 2);
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled({ timeout: 30_000 });
});
