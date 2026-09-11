import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'scripts/validate-stripe-readiness.mjs'), 'utf8');

test('Stripe readiness validator requires canonical runtime billing inputs', () => {
  for (const name of [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_MEMBERSHIP_PRODUCT_ID',
    'BASE_URL',
  ]) assert.match(source, new RegExp(name));
  assert.doesNotMatch(source, /STRIPE_MEMBERSHIP_(?:ONE_TIME_)?PRICE_ID/);
});

test('Stripe browser evidence accepts restricted test keys and rejects live mode', () => {
  assert.match(source, /rk_\(test\|live\)/);
  assert.match(source, /STRIPE_E2E_ENABLED/);
  assert.match(source, /keyMode !== 'test'/);
});

test('Stripe readiness validator rejects malformed provider values', () => {
  assert.match(source, /whsec_/);
  assert.match(source, /prod_/);
  assert.match(source, /BASE_URL must be an HTTPS URL/);
});
