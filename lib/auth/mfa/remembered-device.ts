import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { MfaStore, RememberedDeviceRecord } from './types';

export function digestRememberedDeviceToken(token: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(token, 'utf8').digest('base64url');
}

export async function issueRememberedDevice(input: {
  subjectId: string;
  applicationId: string;
  factorId: string;
  days: number;
  digestSecret: Buffer;
  store: MfaStore;
  nowMs?: number;
}) {
  if (!Number.isInteger(input.days) || input.days <= 0 || input.days > 90) {
    throw new Error('Remembered-device duration must be between 1 and 90 days.');
  }
  if (input.digestSecret.length < 32) {
    throw new Error('Remembered-device digest secret must be at least 32 bytes.');
  }
  const nowMs = input.nowMs ?? Date.now();
  const token = randomBytes(32).toString('base64url');
  const record: RememberedDeviceRecord = {
    rememberedDeviceId: randomUUID(),
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    tokenDigest: digestRememberedDeviceToken(token, input.digestSecret),
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + input.days * 24 * 60 * 60 * 1000,
    revokedAtMs: null,
    factorId: input.factorId,
  };
  await input.store.createRememberedDevice(record);
  return { token, expiresAtMs: record.expiresAtMs };
}

export async function verifyRememberedDevice(input: {
  subjectId: string;
  applicationId: string;
  token: string | null | undefined;
  digestSecrets: readonly Buffer[];
  store: MfaStore;
  nowMs?: number;
}) {
  if (!input.token || !input.digestSecrets.length) return false;
  const nowMs = input.nowMs ?? Date.now();
  for (const secret of input.digestSecrets) {
    const digest = digestRememberedDeviceToken(input.token, secret);
    if (
      (await input.store.consumeRememberedDevice({
        subjectId: input.subjectId,
        applicationId: input.applicationId,
        tokenDigest: digest,
        nowMs,
      })) === 'valid'
    ) {
      return true;
    }
  }
  return false;
}

export function equalOpaqueToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
