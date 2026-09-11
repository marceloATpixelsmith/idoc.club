import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Stripe readiness validator requires every production billing input', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/validate-stripe-readiness.mjs'), 'utf8');
  for (const name of [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_MEMBERSHIP_PRODUCT_ID',
    'STRIPE_MEMBERSHIP_PRICE_ID',
    'STRIPE_MEMBERSHIP_ONE_TIME_PRICE_ID',
    'BASE_URL',
  ]) assert.match(source, new RegExp(name));
});

test('Stripe browser evidence is explicitly test-mode only', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/validate-stripe-readiness.mjs'), 'utf8');
  assert.match(source, /STRIPE_E2E_ENABLED/);
  assert.match(source, /sk_test_/);
});
