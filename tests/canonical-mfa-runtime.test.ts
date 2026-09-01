import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  CompromisedMfaKeyError,
  decideMfa,
  decryptTotpSecret,
  digestRecoveryCode,
  encryptTotpSecret,
  generateRecoveryCode,
  generateTotpSecret,
  resolveMfaEncryptionKey,
  sensitiveActionRequiresFreshStepUp,
  totpProvisioningUri,
  verifyActiveTotp,
  verifyTotpCode,
} from '../lib/auth/mfa/index.ts';
import type { MfaStore, TotpFactorRecord } from '../lib/auth/mfa/types.ts';

function hotpForTest(secretText: string, counter: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const char of secretText) {
    accumulator = (accumulator << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

test('canonical IDOC MFA policy never exposes an MFA-off TOTP requirement', () => {
  assert.equal(
    decideMfa({
      requirement: 'super-admin-only',
      role: 'super-admin',
      hasActiveTotp: false,
      rememberedDeviceValid: false,
      rememberTotpDevice: true,
    }),
    'enrollment-required',
  );
  assert.equal(
    decideMfa({
      requirement: 'super-admin-only',
      role: 'organization-leader',
      hasActiveTotp: false,
      rememberedDeviceValid: false,
      rememberTotpDevice: true,
    }),
    'not-required',
  );
});

test('remembered-device suppression applies only after an active required factor exists', () => {
  assert.equal(
    decideMfa({
      requirement: 'privileged-users',
      role: 'admin',
      hasActiveTotp: true,
      rememberedDeviceValid: true,
      rememberTotpDevice: true,
    }),
    'remembered-device-satisfied',
  );
  assert.equal(
    decideMfa({
      requirement: 'privileged-users',
      role: 'admin',
      hasActiveTotp: false,
      rememberedDeviceValid: true,
      rememberTotpDevice: true,
    }),
    'enrollment-required',
  );
});

test('sensitive TOTP actions still require fresh TOTP evidence', () => {
  assert.equal(
    sensitiveActionRequiresFreshStepUp({
      configuredFactor: 'totp',
      hasFreshPolicyFactor: true,
      hasFreshTotp: false,
      hasFreshWebAuthn: false,
    }),
    true,
  );
});

test('TOTP generation and verification match the canonical six-digit 30-second profile', () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  const uri = totpProvisioningUri({
    secret,
    issuer: 'IDOC',
    accountLabel: 'member@example.com',
  });
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes('algorithm=SHA1'));
  assert.ok(uri.includes('digits=6'));
  assert.ok(uri.includes('period=30'));

  const nowMs = 1_800_000_000_000;
  const counter = Math.floor(nowMs / 1000 / 30);
  assert.equal(verifyTotpCode(secret, hotpForTest(secret, counter), nowMs), counter);
  assert.equal(verifyTotpCode(secret, '12345', nowMs), null);
  assert.throws(() => verifyTotpCode(secret, '000000', nowMs, 2 as 0 | 1), /window must be 0 or 1/i);
});

test('routine TOTP verifier charges invalid codes against the bound challenge', async () => {
  const nowMs = 1_800_000_000_000;
  const secret = 'JBSWY3DPEHPK3PXP';
  const key = Buffer.alloc(32, 7);
  const counter = Math.floor(nowMs / 1000 / 30);
  const validCode = hotpForTest(secret, counter);
  const invalidCode = String((Number(validCode) + 1) % 1_000_000).padStart(6, '0');
  const factor: TotpFactorRecord = {
    activatedAtMs: nowMs - 1000,
    applicationId: 'idoc-web',
    createdAtMs: nowMs - 2000,
    encryptedSecret: encryptTotpSecret(secret, { keyId: 'v1', key }),
    factorId: 'factor-1',
    keyId: 'v1',
    lastAcceptedCounter: counter - 1,
    replacedByFactorId: null,
    status: 'active',
    subjectId: '1',
  };
  let failures = 0;
  const store = {
    getActiveTotp: async () => factor,
    recordChallengeFailure: async () => {
      failures += 1;
      return failures >= 2 ? 'attempts-exhausted' as const : 'recorded' as const;
    },
  } as unknown as MfaStore;
  const input = {
    applicationId: 'idoc-web',
    code: invalidCode,
    nowMs,
    purpose: 'login' as const,
    resolveKey: () => key,
    store,
    subjectId: '1',
    transactionId: 'challenge-1',
  };
  assert.deepEqual(await verifyActiveTotp(input), { status: 'invalid-code' });
  assert.deepEqual(await verifyActiveTotp(input), { status: 'attempts-exhausted' });
  assert.equal(failures, 2);
});

test('TOTP secrets are encrypted with authenticated encryption and key IDs', () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP', { keyId: 'v1', key });
  assert.match(encrypted, /^v1\./);
  assert.equal(decryptTotpSecret(encrypted, (keyId) => {
    assert.equal(keyId, 'v1');
    return key;
  }), 'JBSWY3DPEHPK3PXP');
});

test('AUTH-SECRET-003: resolveMfaEncryptionKey rejects a compromised key distinctly from an unavailable one', () => {
  const key = Buffer.alloc(32, 7);
  const config = { encryptionKeys: new Map([['v1', key], ['v2-compromised', Buffer.alloc(32, 8)]]),
    compromisedKeyIds: new Set(['v2-compromised']) };
  assert.deepEqual(resolveMfaEncryptionKey(config, 'v1'), key);
  assert.throws(() => resolveMfaEncryptionKey(config, 'v2-compromised'), (error: unknown) => {
    assert.ok(error instanceof CompromisedMfaKeyError);
    assert.equal(error.keyId, 'v2-compromised');
    return true;
  });
  assert.throws(() => resolveMfaEncryptionKey(config, 'never-existed'), (error: unknown) => {
    assert.ok(!(error instanceof CompromisedMfaKeyError), 'an unknown key ID is a config-shape problem, not a compromise');
    return /MFA key unavailable/.test(String(error));
  });
});

test('AUTH-SECRET-003: a compromised key still blocks decryption end to end through decryptTotpSecret', () => {
  const compromisedKey = Buffer.alloc(32, 8);
  const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP', { keyId: 'v2-compromised', key: compromisedKey });
  const config = { encryptionKeys: new Map([['v2-compromised', compromisedKey]]),
    compromisedKeyIds: new Set(['v2-compromised']) };
  assert.throws(
    () => decryptTotpSecret(encrypted, (keyId) => resolveMfaEncryptionKey(config, keyId)),
    CompromisedMfaKeyError,
  );
});

test('recovery codes carry the canonical 128 bits of random material and normalize safely', () => {
  const recovery = generateRecoveryCode();
  assert.match(recovery, /^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/);
  assert.equal(recovery.replace(/-/g, '').length, 32);
  const digestSecret = Buffer.alloc(32, 9);
  assert.equal(
    digestRecoveryCode(recovery.toLowerCase().split('-').join(' '), digestSecret),
    digestRecoveryCode(recovery, digestSecret),
  );
});

test('runtime source requires trusted challenge transaction binding for routine TOTP', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile('lib/auth/mfa/totp.ts', 'utf8');
  assert.match(source, /transactionId: string/);
  assert.match(source, /purpose: MfaChallengePurpose/);
  assert.match(source, /acceptTotpChallenge/);
  assert.match(source, /recordChallengeFailure/);
});