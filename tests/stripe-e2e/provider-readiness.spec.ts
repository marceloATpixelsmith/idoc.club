import { test } from '@playwright/test';

/*
 * This file is intentionally not a passing provider-acceptance test. A Product lookup and public
 * page smoke test cannot prove authenticated Checkout, Portal, webhook, database, refund, or
 * renewal behavior. Keep the real acceptance matrix in docs/09 until the complete flow specs exist.
 * The explicit fixme prevents this prerequisite from being reported as Stripe flow evidence.
 */
test.fixme(
  'Stripe provider acceptance requires the complete authenticated Checkout/webhook/database matrix',
  async () => {
    throw new Error(
      'Implement the documented Stripe test-mode acceptance matrix before recording provider evidence.'
    );
  }
);
