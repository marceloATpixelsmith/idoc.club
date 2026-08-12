import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type DeliveryPayload = { email: string; token: string };

type Environment = Partial<Record<string, string | undefined>>;

function activeVersion(environment: Environment) {
  const version = environment.ACCOUNT_DELIVERY_KEY_VERSION;
  if (!version || !/^[A-Za-z0-9_-]{1,30}$/.test(version)) {
    throw new Error('Account delivery active key version is not configured.');
  }
  return version;
}

function configuredKeys(environment: Environment): Record<string, string> {
  const serialized = environment.ACCOUNT_DELIVERY_ENCRYPTION_KEYS;
  if (serialized) {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error('Account delivery key ring configuration is invalid.');
    }
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('Account delivery key ring configuration is invalid.');
    }
    const entries = Object.entries(value);
    if (entries.some(([version, material]) =>
      !/^[A-Za-z0-9_-]{1,30}$/.test(version) || typeof material !== 'string' || material.length < 32
    )) {
      throw new Error('Account delivery key ring configuration is invalid.');
    }
    return Object.fromEntries(entries) as Record<string, string>;
  }

  const legacy = environment.ACCOUNT_DELIVERY_ENCRYPTION_KEY;
  return legacy && legacy.length >= 32 ? { [activeVersion(environment)]: legacy } : {};
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
