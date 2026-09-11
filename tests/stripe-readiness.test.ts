import assert from 'node:assert/strict';
import test from 'node:test';
import {
  stripeDeploymentMode,
  validateStripeBaseUrl,
  validateStripeKey,
  validateStripeMembershipProductId,
  validateStripeReadiness,
  validateStripeWebhookSecret,
} from '../lib/runtime/stripe-configuration.mjs';

const testKey = `sk_test_${'a'.repeat(24)}`;
const restrictedTestKey = `rk_test_${'b'.repeat(24)}`;
const liveKey = `sk_live_${'c'.repeat(24)}`;
const restrictedLiveKey = `rk_live_${'d'.repeat(24)}`;
const base = {
  BASE_URL: 'https://preview.idoc.club',
  STRIPE_MEMBERSHIP_PRODUCT_ID: 'prod_membership123',
  STRIPE_SECRET_KEY: testKey,
  STRIPE_WEBHOOK_SECRET: `whsec_${'e'.repeat(24)}`,
  VERCEL_ENV: 'preview',
};

test('canonical readiness accepts full and restricted keys in the correct deployment mode', () => {
  for (const STRIPE_SECRET_KEY of [testKey, restrictedTestKey]) {
    assert.equal(validateStripeReadiness({ ...base, STRIPE_SECRET_KEY }).keyMode, 'test');
  }
  for (const STRIPE_SECRET_KEY of [liveKey, restrictedLiveKey]) {
    assert.equal(validateStripeReadiness({ ...base, STRIPE_SECRET_KEY, VERCEL_ENV: 'production' }).keyMode, 'live');
  }
});

test('Vercel scopes and local execution resolve modes without treating Preview NODE_ENV as live', () => {
  assert.equal(stripeDeploymentMode({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }), 'test');
  assert.equal(stripeDeploymentMode({ VERCEL_ENV: 'development' }), 'test');
  assert.equal(stripeDeploymentMode({ VERCEL_ENV: 'production' }), 'live');
  assert.equal(stripeDeploymentMode({ NODE_ENV: 'production' }), 'live');
  assert.equal(stripeDeploymentMode({ NODE_ENV: 'development' }), 'test');
});

test('deployment and browser-verification mode mismatches fail closed', () => {
  assert.throws(() => validateStripeKey({ STRIPE_SECRET_KEY: testKey, VERCEL_ENV: 'production' }), /mode/);
  assert.throws(() => validateStripeKey({ STRIPE_SECRET_KEY: liveKey, VERCEL_ENV: 'preview' }), /mode/);
  assert.throws(() => validateStripeKey({ STRIPE_SECRET_KEY: liveKey }, { browserVerification: true }), /test mode/);
  assert.equal(validateStripeKey({ STRIPE_SECRET_KEY: restrictedTestKey }, { browserVerification: true }).mode, 'test');
});

test('malformed keys, URLs, webhook secrets, and Product IDs are rejected', () => {
  for (const value of ['sk_fake_value', 'pk_test_' + 'a'.repeat(24), 'sk_test_short', `sk_test_${'a'.repeat(24)}!`]) {
    assert.throws(() => validateStripeKey({ STRIPE_SECRET_KEY: value }), /shape/);
  }
  for (const value of ['http://idoc.club', 'not-a-url', 'https://user:pass@idoc.club']) {
    assert.throws(() => validateStripeBaseUrl({ BASE_URL: value }), /HTTPS/);
  }
  for (const value of ['secret', 'whsec_short', `whsec_${'a'.repeat(24)}!`]) {
    assert.throws(() => validateStripeWebhookSecret({ STRIPE_WEBHOOK_SECRET: value }), /shape/);
  }
  for (const value of ['price_12345678', 'prod_short', 'not-a-product']) {
    assert.throws(() => validateStripeMembershipProductId({ STRIPE_MEMBERSHIP_PRODUCT_ID: value }), /shape/);
  }
});

test('every real runtime input is required and errors never contain credential values', () => {
  for (const name of ['BASE_URL', 'STRIPE_MEMBERSHIP_PRODUCT_ID', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
    assert.throws(() => validateStripeReadiness({ ...base, [name]: undefined }), new RegExp(name));
  }
  const secret = `sk_live_${'Z'.repeat(24)}`;
  try { validateStripeKey({ STRIPE_SECRET_KEY: secret, VERCEL_ENV: 'preview' }); } catch (error) {
    assert.doesNotMatch(String(error), new RegExp(secret));
  }
});
