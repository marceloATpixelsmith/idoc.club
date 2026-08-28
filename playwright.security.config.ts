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
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  }],
  webServer: {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/sign-in',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'security-e2e-only-auth-secret-32-bytes',
      // A WebAuthn relying-party ID must be a valid domain; Chromium rejects a bare IP address
      // (127.0.0.1) even though it's an otherwise-trustworthy local origin. Every other spec still
      // navigates via the 127.0.0.1 baseURL below and is unaffected -- nothing in this suite asserts
      // on BASE_URL's literal value -- so only the WebAuthn spec needs to address the app at localhost.
      BASE_URL: 'http://localhost:3100',
      POSTGRES_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      RATE_LIMIT_HASH_KEY: process.env.RATE_LIMIT_HASH_KEY ?? 'security-e2e-rate-limit-key-32-bytes',
      TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? 'security-e2e-turnstile-not-contacted',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'security-e2e-site-key',
      MFA_TOTP_ACTIVE_KEY_ID: 'e2e-v1',
      MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'e2e-v1': 'uCl5FBBt6lgvPFEEQVFOOPNh7TVGKX8E4GEBoQuQerw' }),
      MFA_PENDING_AUTH_SIGNING_KEY: 'P-rFOz-JzQlJ6iijr4i9SBPWg-1dn72SbPPY-CHkoqQ',
      MFA_RECOVERY_CODE_DIGEST_KEY: 'zaoDYF2rFZXfbool4YgF40tqjFyibcoukUB8Q13y1Nc',
    },
  },
});
