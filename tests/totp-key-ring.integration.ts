import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { encryptTotpSecret, resolveMfaEncryptionKey, totpCounter, verifyActiveTotp } from '../lib/auth/mfa/totp.ts';
import { mfaEncryptionKeyLifecycle } from '../lib/auth/mfa/key-lifecycle.ts';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import type { TotpEnrollmentRecord, TotpFactorRecord } from '../lib/auth/mfa/types.ts';
import { mfaConfiguration } from '../lib/runtime/configuration.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// AUTH-CRYPTO-005's one remaining gap: unit tests prove resolveKey plumbing in isolation, but nothing
// builds a real two-entry ring via mfaConfiguration() and drives the actual production decrypt/verify
// path (verifyActiveTotp, the function app/(login)/mfa/actions.ts's login and step-up call sites use)
// against a real Postgres-persisted factor, across an active-key rotation.

const applicationId = 'idoc-web';
const store = new PostgresMfaStore(sql);
const otherRequiredMfaEnv = {
  MFA_PENDING_AUTH_SIGNING_KEY: Buffer.alloc(32, 9).toString('base64url'),
  MFA_RECOVERY_CODE_DIGEST_KEY: Buffer.alloc(32, 10).toString('base64url'),
};

beforeEach(resetIdoc);
after(closeHarness);

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

async function insertActiveFactor(subjectId: string, encryptedSecret: string, keyId: string, nowMs: number) {
  const priorCounter = totpCounter(nowMs) - 1;
  const factor: TotpFactorRecord = {
    activatedAtMs: nowMs, applicationId, createdAtMs: nowMs, encryptedSecret,
    factorId: randomUUID(), keyId, lastAcceptedCounter: null, replacedByFactorId: null,
    status: 'pending', subjectId,
  };
  const enrollment: TotpEnrollmentRecord = {
    applicationId, consumedAtMs: null, createdAtMs: nowMs, expiresAtMs: nowMs + 600_000,
    factorId: factor.factorId, purpose: 'mfa-enrollment', subjectId, transactionId: randomUUID(),
  };
  await store.createPendingTotp({ enrollment, factor });
  assert.equal(await store.consumeEnrollmentAndActivate({
    acceptedCounter: priorCounter, applicationId, factorId: factor.factorId, nowMs, subjectId,
    transactionId: enrollment.transactionId,
  }), 'activated');
  return factor.factorId;
}

test('a factor encrypted under a retired key still authenticates through the real production verify path after the active key rotates', async () => {
  const user = await createUser();
  const subjectId = String(user.id);
  const nowMs = Date.now();

  const key1 = Buffer.alloc(32, 1);
  const key2 = Buffer.alloc(32, 2);
  const totpSecret = 'JBSWY3DPEHPK3PXP';

  // Build the real two-entry ring the way mfaConfiguration() actually parses it, with v1 active --
  // matching the enrollment-time configuration a production deployment would have had.
  const configBeforeRotation = mfaConfiguration({
    ...otherRequiredMfaEnv,
    MFA_TOTP_ACTIVE_KEY_ID: 'v1',
    MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ v1: key1.toString('base64url'), v2: key2.toString('base64url') }),
  });
  const encryptedUnderV1 = encryptTotpSecret(totpSecret, { key: key1, keyId: 'v1' });
  await insertActiveFactor(subjectId, encryptedUnderV1, 'v1', nowMs);

  // Rotate: v2 becomes the new active key. v1 remains in the ring (a routine, additive rotation, not
  // a compromise), which is the exact scenario AUTH-CRYPTO-005 flagged as unproven end to end.
  const configAfterRotation = mfaConfiguration({
    ...otherRequiredMfaEnv,
    MFA_TOTP_ACTIVE_KEY_ID: 'v2',
    MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ v1: key1.toString('base64url'), v2: key2.toString('base64url') }),
  });
  assert.equal(configAfterRotation.activeKeyId, 'v2');

  const transactionId = randomUUID();
  await store.createChallenge({ applicationId, expiresAtMs: nowMs + 600_000, maxAttempts: 5, nowMs,
    purpose: 'login', subjectId, transactionId });

  const code = hotpForTest(totpSecret, totpCounter(nowMs));
  const result = await verifyActiveTotp({
    applicationId, code, nowMs, purpose: 'login',
    resolveKey: (keyId) => resolveMfaEncryptionKey(configAfterRotation, keyId),
    store, subjectId, transactionId,
  });
  assert.equal(result.status, 'accepted', 'a factor encrypted under the now-retired v1 key must still verify while v2 is active');

  // And a fresh enrollment under this same rotated configuration would use only the new active key --
  // the ring never falls back to encrypting under a retired key for new material.
  assert.equal(configAfterRotation.encryptionKeys.get(configAfterRotation.activeKeyId)?.equals(key2), true);
});

test('a factor encrypted under a key since removed from the ring entirely fails closed, distinctly from a compromised key', async () => {
  const user = await createUser();
  const subjectId = String(user.id);
  const nowMs = Date.now();
  const key1 = Buffer.alloc(32, 3);
  const key2 = Buffer.alloc(32, 4);
  const totpSecret = 'JBSWY3DPEHPK3PXP';

  const encryptedUnderV1 = encryptTotpSecret(totpSecret, { key: key1, keyId: 'v1' });
  await insertActiveFactor(subjectId, encryptedUnderV1, 'v1', nowMs);

  // v1 is removed from the ring entirely (not merely retired) -- the pre-existing, all-or-nothing
  // lever this row's gap described. This factor now fails closed as "unavailable," not "compromised."
  const configAfterRemoval = mfaConfiguration({
    ...otherRequiredMfaEnv,
    MFA_TOTP_ACTIVE_KEY_ID: 'v2',
    MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({ v2: key2.toString('base64url') }),
  });

  const transactionId = randomUUID();
  await store.createChallenge({ applicationId, expiresAtMs: nowMs + 600_000, maxAttempts: 5, nowMs,
    purpose: 'login', subjectId, transactionId });
  const code = hotpForTest(totpSecret, totpCounter(nowMs));
  await assert.rejects(
    verifyActiveTotp({
      applicationId, code, nowMs, purpose: 'login',
      resolveKey: (keyId) => resolveMfaEncryptionKey(configAfterRemoval, keyId),
      store, subjectId, transactionId,
    }),
    /MFA key unavailable/,
  );
});

// AUTH-CRYPTO-004: "Cryptographic records MUST identify non-secret key versions across pending,
// active, retiring, retired and compromised states." These two tests drive
// mfaEncryptionKeyLifecycle against a real Postgres idoc.mfa_factors table -- not a synthetic count
// -- to prove each state is derived from genuine factor usage (pending/retiring) or correctly
// cross-checked against it (retired), not merely from the operator's own declaration.
test('mfaEncryptionKeyLifecycle identifies pending, active, retiring, retired, and compromised states from real factor usage', async () => {
  const user = await createUser();
  const subjectId = String(user.id);
  const nowMs = Date.now();
  const keyActive = Buffer.alloc(32, 21);
  const keyRetiring = Buffer.alloc(32, 22);
  const keyPending = Buffer.alloc(32, 23);
  const keyRetired = Buffer.alloc(32, 24);
  const keyCompromised = Buffer.alloc(32, 25);

  const config = mfaConfiguration({
    ...otherRequiredMfaEnv,
    MFA_TOTP_ACTIVE_KEY_ID: 'active',
    MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({
      active: keyActive.toString('base64url'),
      retiring: keyRetiring.toString('base64url'),
      pending: keyPending.toString('base64url'),
      retired: keyRetired.toString('base64url'),
      compromised: keyCompromised.toString('base64url'),
    }),
    MFA_TOTP_RETIRED_KEY_IDS: JSON.stringify(['retired']),
    MFA_TOTP_COMPROMISED_KEY_IDS: JSON.stringify(['compromised']),
  });

  // Only "retiring" has a real factor still referencing it -- "pending" and "retired" have none,
  // which is exactly what distinguishes a never-yet-adopted key from a fully decommissioned one.
  const encryptedUnderRetiring = encryptTotpSecret('JBSWY3DPEHPK3PXP', { key: keyRetiring, keyId: 'retiring' });
  await insertActiveFactor(subjectId, encryptedUnderRetiring, 'retiring', nowMs);

  const states = await mfaEncryptionKeyLifecycle(config, sql);
  const byKeyId = new Map(states.map((entry) => [entry.keyId, entry]));

  assert.deepEqual(byKeyId.get('active'), { keyId: 'active', state: 'active', factorCount: 0, retiredWithActiveFactors: false });
  assert.deepEqual(byKeyId.get('retiring'), { keyId: 'retiring', state: 'retiring', factorCount: 1, retiredWithActiveFactors: false });
  assert.deepEqual(byKeyId.get('pending'), { keyId: 'pending', state: 'pending', factorCount: 0, retiredWithActiveFactors: false });
  assert.deepEqual(byKeyId.get('retired'), { keyId: 'retired', state: 'retired', factorCount: 0, retiredWithActiveFactors: false });
  assert.deepEqual(byKeyId.get('compromised'), { keyId: 'compromised', state: 'compromised', factorCount: 0, retiredWithActiveFactors: false });
});

test('mfaEncryptionKeyLifecycle flags a key declared retired that a real factor still references, rather than trusting the declaration silently', async () => {
  const user = await createUser();
  const subjectId = String(user.id);
  const nowMs = Date.now();
  const keyActive = Buffer.alloc(32, 26);
  const keyMistakenlyRetired = Buffer.alloc(32, 27);

  const config = mfaConfiguration({
    ...otherRequiredMfaEnv,
    MFA_TOTP_ACTIVE_KEY_ID: 'active',
    MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({
      active: keyActive.toString('base64url'),
      'mistakenly-retired': keyMistakenlyRetired.toString('base64url'),
    }),
    MFA_TOTP_RETIRED_KEY_IDS: JSON.stringify(['mistakenly-retired']),
  });

  const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP', { key: keyMistakenlyRetired, keyId: 'mistakenly-retired' });
  await insertActiveFactor(subjectId, encrypted, 'mistakenly-retired', nowMs);

  const states = await mfaEncryptionKeyLifecycle(config, sql);
  const entry = states.find((state) => state.keyId === 'mistakenly-retired');
  assert.deepEqual(entry, { keyId: 'mistakenly-retired', state: 'retired', factorCount: 1, retiredWithActiveFactors: true });
});

test('mfaEncryptionKeyLifecycle treats a key referenced only by revoked factors as unused, never stuck at retiring', async () => {
  const user = await createUser();
  const subjectId = String(user.id);
  const nowMs = Date.now();
  const keyActive = Buffer.alloc(32, 28);
  const keyFullyMigrated = Buffer.alloc(32, 29);

  const config = mfaConfiguration({
    ...otherRequiredMfaEnv,
    MFA_TOTP_ACTIVE_KEY_ID: 'active',
    MFA_TOTP_ENCRYPTION_KEYS: JSON.stringify({
      active: keyActive.toString('base64url'),
      'fully-migrated': keyFullyMigrated.toString('base64url'),
    }),
    MFA_TOTP_RETIRED_KEY_IDS: JSON.stringify(['fully-migrated']),
  });

  // The only factor ever encrypted under this key has since been revoked (a terminal, historical
  // state), not merely disabled -- so this key is genuinely done, not "still needed."
  const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP', { key: keyFullyMigrated, keyId: 'fully-migrated' });
  const factorId = await insertActiveFactor(subjectId, encrypted, 'fully-migrated', nowMs);
  assert.equal(
    await store.revokeFactor({ applicationId, factorId, nowMs, reason: 'user_revocation', subjectId }),
    true,
  );

  const states = await mfaEncryptionKeyLifecycle(config, sql);
  const entry = states.find((state) => state.keyId === 'fully-migrated');
  // A correct 'retired' declaration must not be falsely flagged as an anomaly once its only factor is
  // revoked, and the count must not still include that historical row.
  assert.deepEqual(entry, { factorCount: 0, keyId: 'fully-migrated', retiredWithActiveFactors: false, state: 'retired' });
});
