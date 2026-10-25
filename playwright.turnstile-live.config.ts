import { defineConfig, devices } from '@playwright/test';

// Opt-in check of the REAL Cloudflare Turnstile script, run by hand or on a schedule -- never as a
// required PR check, because it needs outbound access to challenges.cloudflare.com and drives a
// cross-origin Cloudflare iframe. The security e2e suite replaces window.turnstile entirely (see
// tests/security-e2e/support/helpers.ts), so on its own nothing exercises Cloudflare's actual
// interactive challenge. This uses Cloudflare's published testing site key that FORCES an
// interactive challenge, so the path production visitors can hit but our own network never does
// (https://developers.cloudflare.com/turnstile/troubleshooting/testing/) is exercised without
// real keys. Run with: pnpm test:turnstile-live
const FORCE_INTERACTIVE_SITE_KEY = '3x00000000000000000000FF';
const port = 3101;

export default defineConfig({
  testDir: './tests/turnstile-live',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  outputDir: 'test-results/turnstile-live',
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  }],
  webServer: {
    command: `pnpm dev --hostname localhost --port ${port}`,
    url: `http://localhost:${port}/sign-in`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_SECRET: 'turnstile-live-only-auth-secret-32-bytes',
      BASE_URL: `http://localhost:${port}`,
      POSTGRES_URL: 'postgres://turnstile-live-placeholder.invalid/idoc_production',
      RATE_LIMIT_HASH_KEY: 'turnstile-live-rate-limit-key-32-bytes',
      // Cloudflare's published always-pass secret; the sign-in page only renders here, nothing submits.
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: FORCE_INTERACTIVE_SITE_KEY,
    },
  },
});
