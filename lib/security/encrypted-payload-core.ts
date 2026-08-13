import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { accountDeliveryConfiguration } from '../runtime/configuration.ts';

export type DeliveryPayload = { email: string; token: string };

type Environment = Partial<Record<string, string | undefined>>;

function activeVersion(environment: Environment) {
  return accountDeliveryConfiguration(environment).activeVersion;
}

function configuredKeys(environment: Environment): Record<string, string> {
  return accountDeliveryConfiguration(environment).keys;
}

function resolveKey(version: string, environment: Environment) {
  const material = configuredKeys(environment)[version];
  if (!material) throw new Error('Account delivery key version is unavailable.');
  return createHash('sha256').update(material).digest();
}

function validatePayload(value: unknown): DeliveryPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid encrypted delivery payload.');
  }
  const { email, token } = value as Record<string, unknown>;
  if (typeof email !== 'string' || email.length > 255 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('Invalid encrypted delivery payload.');
  }
  return { email, token };
}

export function encryptDeliveryPayloadWithEnvironment(value: unknown, environment: Environment) {
  const payload = validatePayload(value);
  const version = activeVersion(environment);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveKey(version, environment), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    encryptedPayload: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url'),
    keyVersion: version,
  };
}

export function decryptDeliveryPayloadWithEnvironment(
  value: string,
  keyVersion: string,
  environment: Environment
) {
  const packed = Buffer.from(value, 'base64url');
  if (packed.length < 29) throw new Error('Invalid encrypted delivery payload.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    resolveKey(keyVersion, environment),
    packed.subarray(0, 12)
  );
  decipher.setAuthTag(packed.subarray(12, 28));
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.concat([
      decipher.update(packed.subarray(28)),
      decipher.final(),
    ]).toString('utf8'));
  } catch {
    throw new Error('Invalid encrypted delivery payload.');
  }
  return validatePayload(decoded);
}
