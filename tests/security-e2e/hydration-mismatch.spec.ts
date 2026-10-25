import { expect, test } from '@playwright/test';

// A signed-in page must hydrate without React reporting a mismatch. Production reported
// "Hydration failed because the server rendered HTML didn't match the client" on
// /dashboard/membership: the sitewide icon-tooltip script added an SVG <title> to an icon inside a
// Suspense boundary that React had not hydrated yet, so React found an element it never rendered.
// React recovers by re-rendering the boundary, which is why this is invisible to a visitor and only
// visible as noise in error monitoring.
const PAGES = ['/dashboard', '/dashboard/membership', '/dashboard/security'];

for (const path of PAGES) {
  test(`${path} hydrates without a mismatch while the icon tooltips are added`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: '.security-e2e/member-a.json' });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat/i.test(message.text())) problems.push(message.text().slice(0, 300));
    });
    page.on('pageerror', (error) => {
      if (/hydrat/i.test(error.message)) problems.push(error.message.slice(0, 300));
    });

    await page.goto(path);
    await page.waitForLoadState('networkidle');
    // Give late-hydrating Suspense boundaries and the tooltip script time to run.
    await page.waitForTimeout(3_000);

    expect(problems).toEqual([]);
    // The tooltips themselves still arrive: a header icon gets its auto title.
    await expect(page.locator('svg > title[data-idoc-auto-tooltip="true"]').first()).toBeAttached({ timeout: 10_000 });
    await context.close();
  });
}
