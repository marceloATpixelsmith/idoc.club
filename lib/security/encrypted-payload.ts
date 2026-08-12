import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key() {
  const material = process.env.ACCOUNT_DELIVERY_ENCRYPTION_KEY;
  if (!material) throw new Error('Account delivery encryption is not configured.');
  return createHash('sha256').update(material).digest();
}

export function encryptDeliveryPayload(value: object) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function decryptDeliveryPayload(value: string) {
  const packed = Buffer.from(value, 'base64url');
  if (packed.length < 29) throw new Error('Invalid encrypted delivery payload.');
  const decipher = createDecipheriv('aes-256-gcm', key(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8')) as { email: string; token: string };
}
