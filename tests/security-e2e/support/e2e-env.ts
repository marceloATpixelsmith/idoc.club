import { resolve } from 'node:path';

/** Shared constants for the security-e2e provider stand-ins. Imported by playwright.security.config.ts
 * (server env), global-setup.ts (resets state) and the specs' helpers, so every side agrees on the
 * same sink/control file paths and the same synthetic Stripe credentials. None of these are real
 * credentials; they only satisfy the app's own shape validation. */
export const E2E_DIR = resolve(process.cwd(), '.security-e2e');
export const E2E_MAIL_SINK = resolve(E2E_DIR, 'mail.jsonl');
export const E2E_CONTROL_FILE = resolve(E2E_DIR, 'control.json');
export const E2E_OUTBOUND_PRELOAD = resolve(process.cwd(), 'tests/security-e2e/support/outbound-preload.cjs');

export const E2E_STRIPE_SECRET_KEY = 'sk_test_e2eMockOnlyKey0123456789ab';
export const E2E_STRIPE_WEBHOOK_SECRET = 'whsec_e2eMockOnlySecret0123456789ab';
export const E2E_STRIPE_MEMBERSHIP_PRODUCT_ID = 'prod_e2eMembershipProduct';
export const E2E_BASE_URL = 'http://127.0.0.1:3100';
