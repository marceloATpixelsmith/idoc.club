import { defineConfig, devices } from '@playwright/test';
import { GOOGLE_MOCK_IDP_URL } from './tests/security-e2e/google-mock-idp';

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
      BASE_URL: 'http://127.0.0.1:3100',
      POSTGRES_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      RATE_LIMIT_HASH_KEY: process.env.RATE_LIMIT_HASH_KEY ?? 'security-e2e-rate-limit-key-32-bytes',
      TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? 'security-e2e-turnstile-not-contacted',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'security-e2e-site-key',
      MFA_TOTP_ACTIVE_KEY_ID: 'e2e-v1',
      MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ 'e2e-v1': 'uCl5FBBt6lgvPFEEQVFOOPNh7TVGKX8E4GEBoQuQerw' }),
      MFA_PENDING_AUTH_SIGNING_KEY: 'P-rFOz-JzQlJ6iijr4i9SBPWg-1dn72SbPPY-CHkoqQ',
      MFA_RECOVERY_CODE_DIGEST_KEY: 'zaoDYF2rFZXfbool4YgF40tqjFyibcoukUB8Q13y1Nc',
      // Synthetic, not a real Google OAuth client -- loadGoogleOidcConfig only requires these to be
      // non-empty and GOOGLE_OAUTH_REDIRECT_URI to be a valid loopback/https URL; nothing here is
      // checked against Google, since GOOGLE_OIDC_TEST_PROVIDER_BASE_URL below points the app at the
      // mock IdP (tests/security-e2e/google-mock-idp.ts) instead of the real Google endpoints.
      GOOGLE_OAUTH_CLIENT_ID: 'security-e2e-test-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'security-e2e-test-client-secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'http://127.0.0.1:3100/api/auth/google/callback',
      GOOGLE_OIDC_TEST_PROVIDER_BASE_URL: GOOGLE_MOCK_IDP_URL,
    },
  },
});
