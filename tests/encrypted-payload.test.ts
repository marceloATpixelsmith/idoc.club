import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptDeliveryPayloadWithEnvironment,
  encryptDeliveryPayloadWithEnvironment,
} from '../lib/security/encrypted-payload-core.ts';

const token = 'a'.repeat(43);
const keyRing = {
  ACCOUNT_DELIVERY_ENCRYPTION_KEYS: JSON.stringify({
    current: 'current-key-material-that-is-at-least-32-bytes',
    previous: 'previous-key-material-that-is-at-least-32-bytes',
  }),
  ACCOUNT_DELIVERY_KEY_VERSION: 'current',
};

test('encrypts with the active version and decrypts with its recorded version', () => {
  const record = encryptDeliveryPayloadWithEnvironment(
    { email: 'member@idoc.club', token },
    keyRing
  );
  assert.equal(record.keyVersion, 'current');
  assert.deepEqual(
    decryptDeliveryPayloadWithEnvironment(
      record.encryptedPayload,
      record.keyVersion,
      keyRing
    ),
    { email: 'member@idoc.club', token }
  );
});

test('older pending records remain decryptable after active-key rotation', () => {
  const oldRecord = encryptDeliveryPayloadWithEnvironment(
    { email: 'member@idoc.club', token },
    { ...keyRing, ACCOUNT_DELIVERY_KEY_VERSION: 'previous' }
  );
  assert.deepEqual(
    decryptDeliveryPayloadWithEnvironment(
      oldRecord.encryptedPayload,
      oldRecord.keyVersion,
      keyRing
    ),
    { email: 'member@idoc.club', token }
  );
});

test('rejects unknown versions, tampering, malformed payloads, and missing configuration', () => {
  const record = encryptDeliveryPayloadWithEnvironment(
    { email: 'member@idoc.club', token },
    keyRing
  );
  assert.throws(() => decryptDeliveryPayloadWithEnvironment(
    record.encryptedPayload,
    'retired',
    keyRing
  ));
  const packed = Buffer.from(record.encryptedPayload, 'base64url');
  packed[packed.length - 1] ^= 1;
  const tampered = packed.toString('base64url');
  assert.throws(() => decryptDeliveryPayloadWithEnvironment(tampered, 'current', keyRing));
  assert.throws(() => encryptDeliveryPayloadWithEnvironment(
    { email: 'member@idoc.club', token: 'raw-short-token' },
    keyRing
  ));
  assert.throws(() => encryptDeliveryPayloadWithEnvironment(
    { email: 'member@idoc.club', token },
    {}
  ));
});
