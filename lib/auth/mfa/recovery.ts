import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { MfaStore, RecoveryCodeRecord } from './types';

export const RECOVERY_CODE_COUNT = 10;

function normalizeRecoveryCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function digestRecoveryCode(code: string, secret: Buffer): string {
  return createHmac('sha256', secret)
    .update(normalizeRecoveryCode(code), 'utf8')
    .digest('base64url');
}

export function generateRecoveryCode(): string {
  const raw = randomBytes(16).toString('hex').toUpperCase();
  return `${raw.slice(0, 8)}-${raw.slice(8, 16)}-${raw.slice(16, 24)}-${raw.slice(24, 32)}`;
}

export function prepareRecoveryCodes(input: {
  subjectId: string;
  applicationId: string;
  digestSecret: Buffer;
  nowMs?: number;
}) {
  if (input.digestSecret.length < 32) {
    throw new Error('Recovery-code digest secret must be at least 32 bytes.');
  }
  const nowMs = input.nowMs ?? Date.now();
  const generationId = randomUUID();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  const records: RecoveryCodeRecord[] = codes.map((code) => ({
    recoveryCodeId: randomUUID(),
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    digest: digestRecoveryCode(code, input.digestSecret),
    createdAtMs: nowMs,
    consumedAtMs: null,
    generationId,
  }));
  return { generationId, codes, records, nowMs };
}

export async function replaceRecoveryCodes(input: {
  subjectId: string;
  applicationId: string;
  digestSecret: Buffer;
  store: MfaStore;
  nowMs?: number;
}) {
  const prepared = prepareRecoveryCodes(input);
  await input.store.replaceRecoveryCodes({
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    generationId: prepared.generationId,
    codes: prepared.records,
    nowMs: prepared.nowMs,
  });
  return { generationId: prepared.generationId, codes: prepared.codes };
}

export async function consumeRecoveryCode(input: {
  subjectId: string;
  applicationId: string;
  code: string;
  digestSecrets: readonly Buffer[];
  store: MfaStore;
  nowMs?: number;
}) {
  if (!input.digestSecrets.length) {
    throw new Error('At least one recovery-code digest secret is required.');
  }
  const digests = input.digestSecrets.map((secret) => digestRecoveryCode(input.code, secret));
  const status = await input.store.consumeRecoveryCode({
    subjectId: input.subjectId,
    applicationId: input.applicationId,
    digests,
    nowMs: input.nowMs ?? Date.now(),
  });
  return { status: status === 'consumed' ? ('recovery-authorized' as const) : ('invalid' as const) };
}
