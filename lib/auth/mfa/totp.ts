import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type {
  MfaChallengePurpose,
  MfaStore,
  TotpEnrollmentRecord,
  TotpFactorRecord,
} from './types';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ENROLLMENT_TTL_MS = 10 * 60 * 1000;

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Buffer {
  const clean = value.toUpperCase().replace(/=+$/g, '');
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error('Invalid TOTP secret.');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

function equalCode(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpProvisioningUri(input: {
  secret: string;
  issuer: string;
  accountLabel: string;
}): string {
  const label = `${input.issuer}:${input.accountLabel}`;
  const url = new URL(`otpauth://totp/${encodeURIComponent(label)}`);
  url.searchParams.set('secret', input.secret);
  url.searchParams.set('issuer', input.issuer);
  url.searchParams.set('algorithm', 'SHA1');
  url.searchParams.set('digits', String(TOTP_DIGITS));
  url.searchParams.set('period', String(TOTP_PERIOD_SECONDS));
  return url.toString();
}

export function totpCounter(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function verifyTotpCode(
  secret: string,
  code: string,
  nowMs = Date.now(),
  window: 0 | 1 = 1,
): number | null {
  if (window !== 0 && window !== 1) {
    throw new Error('TOTP verification window must be 0 or 1.');
  }
  if (!/^\d{6}$/.test(code)) return null;
  const material = base32Decode(secret);
  const current = totpCounter(nowMs);
  for (let delta = -window; delta <= window; delta += 1) {
    const counter = current + delta;
    if (counter >= 0 && equalCode(hotp(material, counter), code)) return counter;
  }
  return null;
}

export function encryptTotpSecret(secret: string, input: { keyId: string; key: Buffer }): string {
  if (input.key.length !== 32) throw new Error('TOTP encryption key must be 32 bytes.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', input.key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${input.keyId}.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptTotpSecret(serialized: string, resolveKey: (keyId: string) => Buffer): string {
  const [keyId, ivText, tagText, ciphertextText, extra] = serialized.split('.');
  if (!keyId || !ivText || !tagText || !ciphertextText || extra) {
    throw new Error('Invalid encrypted TOTP secret.');
  }
  const key = resolveKey(keyId);
  if (key.length !== 32) throw new Error('Invalid TOTP encryption key.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export async function beginTotpEnrollment(input: {
  subjectId: string;
  applicationId: string;
  issuer: string;
  accountLabel: string;
  keyId: string;
  encryptionKey: Buffer;
  purpose?: TotpEnrollmentRecord['purpose'];
  store: MfaStore;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const factorId = randomUUID();
  const transactionId = randomUUID();
  const secret = generateTotpSecret();
  const factor: TotpFactorRecord = {
    factorId,
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    status: 'pending',
    encryptedSecret: encryptTotpSecret(secret, {
      keyId: input.keyId,
      key: input.encryptionKey,
    }),
    keyId: input.keyId,
    createdAtMs: nowMs,
    activatedAtMs: null,
    replacedByFactorId: null,
    lastAcceptedCounter: null,
  };
  const enrollment: TotpEnrollmentRecord = {
    transactionId,
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    factorId,
    purpose: input.purpose ?? 'mfa-enrollment',
    createdAtMs: nowMs,
    expiresAtMs: nowMs + TOTP_ENROLLMENT_TTL_MS,
    consumedAtMs: null,
  };
  await input.store.createPendingTotp({ factor, enrollment });
  return {
    factorId,
    transactionId,
    provisioningUri: totpProvisioningUri({
      secret,
      issuer: input.issuer,
      accountLabel: input.accountLabel,
    }),
  };
}

export async function completeTotpEnrollment(input: {
  transactionId: string;
  subjectId: string;
  applicationId: string;
  factorId: string;
  code: string;
  store: MfaStore;
  resolveKey: (keyId: string) => Buffer;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const pending = await input.store.getPendingTotpEnrollment({
    transactionId: input.transactionId,
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    factorId: input.factorId,
    nowMs,
  });
  if (
    !pending ||
    pending.factor.status !== 'pending' ||
    pending.enrollment.consumedAtMs !== null ||
    pending.enrollment.expiresAtMs <= nowMs
  ) {
    return { status: 'invalid-transaction' as const };
  }
  const secret = decryptTotpSecret(pending.factor.encryptedSecret, input.resolveKey);
  const counter = verifyTotpCode(secret, input.code, nowMs);
  if (counter === null) return { status: 'invalid-code' as const };
  const outcome = await input.store.consumeEnrollmentAndActivate({
    transactionId: input.transactionId,
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    factorId: input.factorId,
    acceptedCounter: counter,
    nowMs,
  });
  return { status: outcome };
}

export async function verifyActiveTotp(input: {
  transactionId: string;
  purpose: MfaChallengePurpose;
  subjectId: string;
  applicationId: string;
  code: string;
  store: MfaStore;
  resolveKey: (keyId: string) => Buffer;
  nowMs?: number;
}) {
  const factor = await input.store.getActiveTotp(input.subjectId, input.applicationId);
  if (!factor || factor.status !== 'active') return { status: 'not-enrolled' as const };
  const secret = decryptTotpSecret(factor.encryptedSecret, input.resolveKey);
  const nowMs = input.nowMs ?? Date.now();
  const counter = verifyTotpCode(secret, input.code, nowMs);
  if (counter === null) return { status: 'invalid-code' as const };
  const accepted = await input.store.acceptTotpChallenge({
    transactionId: input.transactionId,
    purpose: input.purpose,
    factorId: factor.factorId,
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    counter,
    nowMs,
  });
  return { status: accepted };
}
