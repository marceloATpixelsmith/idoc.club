import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountDeliveryConfiguration,
  authSecretForServer,
  baseUrlForServer,
  databaseUrlForServer,
  privilegedProductionConfiguration,
  stripeKeyForServer,
  stripeOneTimeProductIdForServer,
  stripeRecurringProductIdForServer,
} from '../lib/runtime/configuration.ts';

const valid = {
  ACCOUNT_DELIVERY_ENCRYPTION_KEYS: JSON.stringify({ current: 'a'.repeat(32) }),
  ACCOUNT_DELIVERY_KEY_VERSION: 'current', AUTH_SECRET: 'b'.repeat(32),
  BASE_URL: 'https://idoc.club', CRON_SECRET: 'c'.repeat(32),
  IDOC_ADMIN_NOTIFICATION_EMAIL: 'operations@idoc.club',
  MAILCHIMP_TRANSACTIONAL_API_KEY: 'd'.repeat(32),
  POSTGRES_URL: 'postgres://user:password@database.internal:5432/idoc',
  RATE_LIMIT_HASH_KEY: 'e'.repeat(32), STRIPE_ONE_TIME_PRODUCT_ID: 'prod_one_time_live',
  STRIPE_RECURRING_PRODUCT_ID: 'prod_recurring_live', STRIPE_SECRET_KEY: `sk_live_${'f'.repeat(24)}`,
  STRIPE_WEBHOOK_SECRET: 'g'.repeat(32),
  TURNSTILE_SECRET_KEY: 'h'.repeat(32),
};

test('complete privileged production configuration accepts explicit valid values', () => {
  const configuration = privilegedProductionConfiguration(valid);
  assert.equal(configuration.baseUrl, valid.BASE_URL);
  assert.equal(configuration.accountDelivery.activeVersion, 'current');
});

test('every privileged setting fails closed when missing, empty, or whitespace-only', () => {
  for (const name of Object.keys(valid)) {
    for (const replacement of [undefined, '', '   ']) {
      const environment = { ...valid, [name]: replacement };
      assert.throws(() => privilegedProductionConfiguration(environment), new RegExp(name));
    }
  }
});

test('malformed URLs, undersized secrets, and malformed provider settings fail categorically', () => {
  assert.throws(() => databaseUrlForServer({ POSTGRES_URL: 'https://database.invalid' }), /POSTGRES_URL/);
  assert.throws(() => baseUrlForServer({ BASE_URL: 'http://localhost:3000', NODE_ENV: 'production' }), /BASE_URL/);
  assert.throws(() => baseUrlForServer({ BASE_URL: 'http://idoc.club', NODE_ENV: 'development' }), /BASE_URL/);
  assert.throws(() => authSecretForServer({ AUTH_SECRET: 'supplied-secret-value' }), /AUTH_SECRET/);
  assert.throws(() => stripeKeyForServer({ STRIPE_SECRET_KEY: 'sk_fake_value' }), /STRIPE_SECRET_KEY/);
  assert.equal(stripeKeyForServer({ STRIPE_SECRET_KEY: `rk_test_${'h'.repeat(24)}` }), `rk_test_${'h'.repeat(24)}`, 'a restricted key must be accepted alongside a full-access secret key');
  assert.throws(() => stripeRecurringProductIdForServer({ STRIPE_RECURRING_PRODUCT_ID: 'not-a-product' }), /STRIPE_RECURRING_PRODUCT_ID/);
  assert.throws(() => stripeOneTimeProductIdForServer({ STRIPE_ONE_TIME_PRODUCT_ID: 'not-a-product' }), /STRIPE_ONE_TIME_PRODUCT_ID/);
  assert.equal(stripeRecurringProductIdForServer({ STRIPE_RECURRING_PRODUCT_ID: 'prod_fixture123' }), 'prod_fixture123');
  for (const [name, value] of Object.entries(valid)) {
    const supplied = `DO_NOT_EXPOSE_${name}_${value}`;
    try { privilegedProductionConfiguration({ ...valid, [name]: supplied }); } catch (error) {
      assert.doesNotMatch(String(error), /DO_NOT_EXPOSE|database\.internal|sk_live_/);
    }
  }
});

test('development permits loopback HTTP without weakening production HTTPS', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(baseUrlForServer({ BASE_URL: `http://${hostname}:3000`, NODE_ENV: 'development' }), `http://${hostname}:3000`);
  }
  assert.equal(baseUrlForServer({ BASE_URL: 'https://preview.idoc.club', NODE_ENV: 'development' }), 'https://preview.idoc.club');
});

test('key rings reject malformed mappings and require the active version', () => {
  for (const environment of [
    { ACCOUNT_DELIVERY_KEY_VERSION: 'current', ACCOUNT_DELIVERY_ENCRYPTION_KEYS: '{' },
    { ACCOUNT_DELIVERY_KEY_VERSION: 'current', ACCOUNT_DELIVERY_ENCRYPTION_KEYS: '[]' },
    { ACCOUNT_DELIVERY_KEY_VERSION: 'current', ACCOUNT_DELIVERY_ENCRYPTION_KEYS: JSON.stringify({ old: 'x'.repeat(32) }) },
    { ACCOUNT_DELIVERY_KEY_VERSION: 'current', ACCOUNT_DELIVERY_ENCRYPTION_KEYS: JSON.stringify({ current: 'short' }) },
  ]) assert.throws(() => accountDeliveryConfiguration(environment), /ACCOUNT_DELIVERY/);
});

test('production build phase and NODE_ENV never enable placeholder credentials', () => {
  for (const environment of [{ NEXT_PHASE: 'phase-production-build' }, { NODE_ENV: 'production' }, { NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }]) {
    assert.throws(() => databaseUrlForServer(environment), /POSTGRES_URL/);
    assert.throws(() => stripeKeyForServer(environment), /STRIPE_SECRET_KEY/);
  }
});
