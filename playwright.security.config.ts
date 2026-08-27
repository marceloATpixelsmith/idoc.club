import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/(?:^|[_-])test(?:$|[_-])|\/[^/?]*test[^/?]*(?:\?|$)/i.test(databaseUrl)) {
  throw new Error('Security E2E requires an unmistakably test-only TEST_DATABASE_URL.');
}

export default defineConfig({
  testDir: './tests/security-e2e',
  fullyParallel: false,
  workers: 1,
  globalSetup: './tests/security-e2e/global-setup.ts',
  outputDir: 'test-results/security-e2e',
  reporter: process.env.CI ? [['dot'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/sign-in',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'security-e2e-only-auth-secret-32-bytes',
      BASE_URL: 'http://127.0.0.1:3100',
      POSTGRES_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      RATE_LIMIT_HASH_KEY: process.env.RATE_LIMIT_HASH_KEY ?? 'security-e2e-rate-limit-key-32-bytes',
      TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? 'security-e2e-turnstile-not-contacted',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'security-e2e-site-key',
    },
  },
});
