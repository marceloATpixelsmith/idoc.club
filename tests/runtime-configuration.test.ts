import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountDeliveryConfiguration,
  authSecretForServer,
  baseUrlForServer,
  databaseUrlForServer,
  privilegedProductionConfiguration,
  stripeKeyForServer,
} from '../lib/runtime/configuration.ts';

const valid = {
  ACCOUNT_DELIVERY_ENCRYPTION_KEYS: JSON.stringify({ current: 'a'.repeat(32) }),
  ACCOUNT_DELIVERY_KEY_VERSION: 'current', AUTH_SECRET: 'b'.repeat(32),
  BASE_URL: 'https://idoc.club', CRON_SECRET: 'c'.repeat(32),
  IDOC_ADMIN_NOTIFICATION_EMAIL: 'operations@idoc.club',
  MAILCHIMP_TRANSACTIONAL_API_KEY: 'd'.repeat(32),
  POSTGRES_URL: 'postgres://user:password@database.internal:5432/idoc',
  RATE_LIMIT_HASH_KEY: 'e'.repeat(32), STRIPE_SECRET_KEY: `sk_live_${'f'.repeat(24)}`,
  STRIPE_WEBHOOK_SECRET: 'g'.repeat(32),
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
  assert.throws(() => baseUrlForServer({ BASE_URL: 'http://localhost:3000' }), /BASE_URL/);
  assert.throws(() => authSecretForServer({ AUTH_SECRET: 'supplied-secret-value' }), /AUTH_SECRET/);
  assert.throws(() => stripeKeyForServer({ STRIPE_SECRET_KEY: 'sk_fake_value' }), /STRIPE_SECRET_KEY/);
  for (const [name, value] of Object.entries(valid)) {
    const supplied = `DO_NOT_EXPOSE_${name}_${value}`;
    try { privilegedProductionConfiguration({ ...valid, [name]: supplied }); } catch (error) {
      assert.doesNotMatch(String(error), /DO_NOT_EXPOSE|database\.internal|sk_live_/);
    }
  }
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
