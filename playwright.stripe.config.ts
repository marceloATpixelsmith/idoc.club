import { defineConfig, devices } from '@playwright/test';
import { validateTestDatabaseUrl } from './lib/db/test-database-url';
import { validateStripeReadiness } from './lib/runtime/stripe-configuration.mjs';

if (process.env.STRIPE_E2E_ENABLED !== 'true') {
  throw new Error('Stripe E2E is opt-in: set STRIPE_E2E_ENABLED=true to run it.');
}

const databaseUrl = validateTestDatabaseUrl(
  process.env.TEST_DATABASE_URL,
  process.env.POSTGRES_URL,
).toString();
const stripeConfiguration = validateStripeReadiness(process.env, { browserVerification: true });
const appUrl = process.env.STRIPE_E2E_APP_URL?.trim();
if (!appUrl) throw new Error('Stripe E2E requires STRIPE_E2E_APP_URL for the reachable test application.');
const parsedAppUrl = new URL(appUrl);
if (!['http:', 'https:'].includes(parsedAppUrl.protocol) || !parsedAppUrl.hostname) {
  throw new Error('Stripe E2E requires a valid STRIPE_E2E_APP_URL.');
}

export default defineConfig({
  testDir: './tests/stripe-e2e',
  fullyParallel: false,
  workers: 1,
  globalSetup: './tests/stripe-e2e/global-setup.ts',
  outputDir: 'test-results/stripe-e2e',
  reporter: process.env.CI ? [['dot'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: parsedAppUrl.origin,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{
    name: 'stripe-test-mode-chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {},
    },
  }],
  metadata: {
    database: 'disposable-test-only',
    stripeMode: stripeConfiguration.keyMode,
  },
  webServer: process.env.STRIPE_E2E_START_COMMAND ? {
    command: process.env.STRIPE_E2E_START_COMMAND,
    env: { ...process.env, POSTGRES_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl },
    reuseExistingServer: false,
    timeout: 120_000,
    url: parsedAppUrl.origin,
  } : undefined,
});
