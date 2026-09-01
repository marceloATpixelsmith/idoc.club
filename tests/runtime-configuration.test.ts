import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountDeliveryConfiguration,
  authSecretForServer,
  authSecretRingForServer,
  baseUrlForServer,
  databaseUrlForServer,
  loginDeviceTrustDigestKeyForServer,
  mailchimpApiKeyForServer,
  mfaConfiguration,
  privilegedProductionConfiguration,
  stripeKeyForServer,
  stripeOneTimeProductIdForServer,
  stripeRecurringProductIdForServer,
  supportEmailForServer,
} from '../lib/runtime/configuration.ts';

const valid = {
  ACCOUNT_DELIVERY_ENCRYPTION_KEYS: JSON.stringify({ current: 'a'.repeat(32) }),
  ACCOUNT_DELIVERY_KEY_VERSION: 'current', AUTH_SECRET: 'b'.repeat(32),
  BASE_URL: 'https://idoc.club', CRON_SECRET: 'c'.repeat(32),
  IDOC_ADMIN_NOTIFICATION_EMAIL: 'operations@idoc.club',
  LOGIN_DEVICE_TRUST_DIGEST_KEY: Buffer.alloc(32, 4).toString('base64url'),
  MAILCHIMP_TRANSACTIONAL_API_KEY: 'd'.repeat(22),
  POSTGRES_URL: 'postgres://user:password@database.internal:5432/idoc',
  RATE_LIMIT_HASH_KEY: 'e'.repeat(32), STRIPE_ONE_TIME_PRODUCT_ID: 'prod_one_time_live',
  STRIPE_RECURRING_PRODUCT_ID: 'prod_recurring_live', STRIPE_SECRET_KEY: `sk_live_${'f'.repeat(24)}`,
  STRIPE_WEBHOOK_SECRET: 'g'.repeat(32),
  TURNSTILE_SECRET_KEY: 'h'.repeat(32),
};

const key32 = Buffer.alloc(32, 7).toString('base64url');
const validMfa = {
  MFA_PENDING_AUTH_SIGNING_KEY: Buffer.alloc(32, 1).toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: Buffer.alloc(32, 2).toString('base64url'),
  MFA_TOTP_ACTIVE_KEY_ID: 'current',
  MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ current: key32 }),
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
  assert.throws(() => authSecretRingForServer({ AUTH_SECRET: 'supplied-secret-value' }), /AUTH_SECRET/);
  assert.throws(() => loginDeviceTrustDigestKeyForServer({ LOGIN_DEVICE_TRUST_DIGEST_KEY: 'short' }), /LOGIN_DEVICE_TRUST_DIGEST_KEY/);
  assert.equal(loginDeviceTrustDigestKeyForServer({ LOGIN_DEVICE_TRUST_DIGEST_KEY: Buffer.alloc(32, 4).toString('base64url') }).length, 32);
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

test('AUTH-CRYPTO-005: the AUTH_SECRET ring is a single-key hard-cutover by default and never demands its own variable when unset', () => {
  assert.deepEqual(authSecretRingForServer({ AUTH_SECRET: 'a'.repeat(32) }), ['a'.repeat(32)]);
  assert.deepEqual(authSecretRingForServer({ AUTH_SECRET: 'a'.repeat(32), AUTH_SECRET_RETIRED_KEYS: '   ' }), ['a'.repeat(32)]);
});

test('AUTH-CRYPTO-005: retired AUTH_SECRET values remain valid for verification, active key always first, duplicates collapsed', () => {
  const environment = {
    AUTH_SECRET: 'a'.repeat(32),
    AUTH_SECRET_RETIRED_KEYS: JSON.stringify(['b'.repeat(32), 'a'.repeat(32), 'c'.repeat(32)]),
  };
  assert.deepEqual(authSecretRingForServer(environment), ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)]);
});

test('AUTH-CRYPTO-005: a malformed or undersized AUTH_SECRET_RETIRED_KEYS fails closed', () => {
  const base = { AUTH_SECRET: 'a'.repeat(32) };
  for (const AUTH_SECRET_RETIRED_KEYS of ['{', '{}', '"not-an-array"', JSON.stringify(['short']), JSON.stringify([1])]) {
    assert.throws(() => authSecretRingForServer({ ...base, AUTH_SECRET_RETIRED_KEYS }), /AUTH_SECRET_RETIRED_KEYS/);
  }
});

test('the Mailchimp Transactional API key is accepted at its real, shorter length and only rejected when actually blank or missing', () => {
  // Regression test: this key is a third-party-issued Mandrill credential in a fixed, ~22-character
  // format, not a self-generated secret like AUTH_SECRET/CRON_SECRET/RATE_LIMIT_HASH_KEY that should
  // be long and random. A blanket 32-character minimum previously rejected genuinely valid,
  // correctly configured production keys as "not configured."
  assert.equal(mailchimpApiKeyForServer({ MAILCHIMP_TRANSACTIONAL_API_KEY: 'md-1234567890abcdefghij' }), 'md-1234567890abcdefghij');
  for (const value of [undefined, '', '   ']) {
    assert.throws(() => mailchimpApiKeyForServer({ MAILCHIMP_TRANSACTIONAL_API_KEY: value }), /MAILCHIMP_TRANSACTIONAL_API_KEY/);
  }
});

test('production build phase and NODE_ENV never enable placeholder credentials', () => {
  for (const environment of [{ NEXT_PHASE: 'phase-production-build' }, { NODE_ENV: 'production' }, { NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }]) {
    assert.throws(() => databaseUrlForServer(environment), /POSTGRES_URL/);
    assert.throws(() => stripeKeyForServer(environment), /STRIPE_SECRET_KEY/);
  }
});

test('the support-contact address is policy-configured, with a real fallback, and never fails closed when unset', () => {
  assert.equal(supportEmailForServer({ SUPPORT_EMAIL: 'help@idoc.club' }), 'help@idoc.club');
  assert.equal(supportEmailForServer({}), 'support@idoc.club');
  assert.equal(supportEmailForServer({ SUPPORT_EMAIL: '   ' }), 'support@idoc.club');
});

test('canonical MFA configuration accepts a valid explicit key ring', () => {
  const configuration = mfaConfiguration(validMfa);
  assert.equal(configuration.activeKeyId, 'current');
  assert.deepEqual(configuration.encryptionKeys.get('current'), Buffer.alloc(32, 7));
});

test('AUTH-SECRET-003: MFA_TOTP_COMPROMISED_KEY_IDS is empty by default and never demands its own variable when unset', () => {
  assert.deepEqual(mfaConfiguration(validMfa).compromisedKeyIds, new Set());
  assert.deepEqual(mfaConfiguration({ ...validMfa, MFA_TOTP_COMPROMISED_KEY_IDS: '   ' }).compromisedKeyIds, new Set());
});

test('AUTH-SECRET-003: a retired-but-still-present key can be marked compromised without disturbing the ring', () => {
  const key32b = Buffer.alloc(32, 8).toString('base64url');
  const withRetired = {
    ...validMfa,
    MFA_TOTP_COMPROMISED_KEY_IDS: JSON.stringify(['retired']),
    MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ current: key32, retired: key32b }),
  };
  const configuration = mfaConfiguration(withRetired);
  assert.deepEqual(configuration.compromisedKeyIds, new Set(['retired']));
  // Marking a key compromised must never remove it from the ring: decrypt-time rejection lives in
  // resolveMfaEncryptionKey, not here, and the material must stay visible to this validation and any
  // future migration tooling.
  assert.deepEqual(configuration.encryptionKeys.get('retired'), Buffer.alloc(32, 8));
});

test('AUTH-SECRET-003: fails closed marking an unknown key ID or the active key ID compromised', () => {
  assert.throws(
    () => mfaConfiguration({ ...validMfa, MFA_TOTP_COMPROMISED_KEY_IDS: JSON.stringify(['never-enrolled']) }),
    /MFA_TOTP_COMPROMISED_KEY_IDS/,
  );
  assert.throws(
    () => mfaConfiguration({ ...validMfa, MFA_TOTP_COMPROMISED_KEY_IDS: JSON.stringify(['current']) }),
    /MFA_TOTP_COMPROMISED_KEY_IDS/,
  );
  for (const MFA_TOTP_COMPROMISED_KEY_IDS of ['{', '{}', '"not-an-array"', JSON.stringify([1])]) {
    assert.throws(() => mfaConfiguration({ ...validMfa, MFA_TOTP_COMPROMISED_KEY_IDS }), /MFA_TOTP_COMPROMISED_KEY_IDS/);
  }
});

test('remembered-TOTP-device policy is off by default and never demands its own secret when unset', () => {
  const configuration = mfaConfiguration(validMfa);
  assert.equal(configuration.rememberedDevice.enabled, false);
  assert.equal(configuration.rememberedDevice.digestSecret, null);
  assert.equal(configuration.rememberedDevice.days, 30);
});

test('remembered-TOTP-device policy fails closed on its own digest key and day bounds once explicitly enabled', () => {
  const digestKey = Buffer.alloc(32, 9).toString('base64url');
  const enabled = { ...validMfa, MFA_REMEMBERED_DEVICE_DIGEST_KEY: digestKey, REMEMBER_TOTP_DEVICE_ENABLED: 'true' };
  const configuration = mfaConfiguration(enabled);
  assert.equal(configuration.rememberedDevice.enabled, true);
  assert.equal(configuration.rememberedDevice.days, 30);
  assert.deepEqual(configuration.rememberedDevice.digestSecret, Buffer.alloc(32, 9));

  assert.equal(mfaConfiguration({ ...enabled, REMEMBER_TOTP_DEVICE_DAYS: '14' }).rememberedDevice.days, 14);
  assert.throws(() => mfaConfiguration({ ...enabled, REMEMBER_TOTP_DEVICE_DAYS: '0' }), /REMEMBER_TOTP_DEVICE_DAYS/);
  assert.throws(() => mfaConfiguration({ ...enabled, REMEMBER_TOTP_DEVICE_DAYS: '91' }), /REMEMBER_TOTP_DEVICE_DAYS/);
  assert.throws(() => mfaConfiguration({ ...enabled, REMEMBER_TOTP_DEVICE_DAYS: 'not-a-number' }), /REMEMBER_TOTP_DEVICE_DAYS/);
  assert.throws(() => mfaConfiguration({ ...enabled, MFA_REMEMBERED_DEVICE_DIGEST_KEY: undefined }), /MFA_REMEMBERED_DEVICE_DIGEST_KEY/);
  assert.throws(() => mfaConfiguration({ ...enabled, MFA_REMEMBERED_DEVICE_DIGEST_KEY: Buffer.alloc(31).toString('base64url') }), /MFA_REMEMBERED_DEVICE_DIGEST_KEY/);
});

test('canonical MFA configuration rejects missing or absent active keys and malformed JSON', () => {
  assert.throws(() => mfaConfiguration({ ...validMfa, MFA_TOTP_ACTIVE_KEY_ID: undefined }), /MFA_TOTP_ACTIVE_KEY_ID/);
  assert.throws(() => mfaConfiguration({ ...validMfa, MFA_TOTP_ACTIVE_KEY_ID: 'absent' }), /MFA_TOTP_ACTIVE_KEY_ID/);
  assert.throws(() => mfaConfiguration({ ...validMfa, MFA_TOTP_ENCRYPTION_KEYS: '{' }), /MFA_TOTP_ENCRYPTION_KEYS/);
});

test('canonical MFA configuration rejects malformed, padded, and incorrectly sized key material', () => {
  for (const material of ['not+base64url', `${key32}=`, Buffer.alloc(31, 3).toString('base64url'), Buffer.alloc(33, 3).toString('base64url')]) {
    assert.throws(
      () => mfaConfiguration({ ...validMfa, MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ current: material }) }),
      /MFA_TOTP_ENCRYPTION_KEYS/
    );
  }
  for (const name of ['MFA_RECOVERY_CODE_DIGEST_KEY', 'MFA_PENDING_AUTH_SIGNING_KEY'] as const) {
    assert.throws(() => mfaConfiguration({ ...validMfa, [name]: Buffer.alloc(31).toString('base64url') }), new RegExp(name));
    assert.throws(() => mfaConfiguration({ ...validMfa, [name]: 'not+base64url' }), new RegExp(name));
  }
  assert.throws(
    () => loginDeviceTrustDigestKeyForServer({ LOGIN_DEVICE_TRUST_DIGEST_KEY: Buffer.alloc(31).toString('base64url') }),
    /LOGIN_DEVICE_TRUST_DIGEST_KEY/
  );
});
