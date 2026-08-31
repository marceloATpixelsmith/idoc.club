import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { issueRememberedDevice, verifyRememberedDevice } from '../lib/auth/mfa/remembered-device.ts';
import type { TotpEnrollmentRecord, TotpFactorRecord } from '../lib/auth/mfa/types.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

const applicationId = 'idoc-web';
const nowMs = 1_800_000_000_000;
const store = new PostgresMfaStore(sql);
const digestSecret = randomBytes(32);

beforeEach(resetIdoc);
after(closeHarness);

async function activeFactor(subjectId: string) {
  const factor: TotpFactorRecord = {
    activatedAtMs: null, applicationId, createdAtMs: nowMs, encryptedSecret: 'v1.iv.tag.ciphertext',
    factorId: randomUUID(), keyId: 'v1', lastAcceptedCounter: null, replacedByFactorId: null,
    status: 'pending', subjectId,
  };
  const enrollment: TotpEnrollmentRecord = {
    applicationId, consumedAtMs: null, createdAtMs: nowMs, expiresAtMs: nowMs + 60_000,
    factorId: factor.factorId, purpose: 'mfa-enrollment', subjectId, transactionId: randomUUID(),
  };
  await store.createPendingTotp({ enrollment, factor });
  await store.consumeEnrollmentAndActivate({ acceptedCounter: 100, applicationId, factorId: factor.factorId,
    nowMs, subjectId, transactionId: enrollment.transactionId });
  return factor;
}

test('issueRememberedDevice mints an opaque token, persists only its digest, and verifyRememberedDevice accepts the real token', async () => {
  const owner = await createUser();
  const factor = await activeFactor(String(owner.id));
  const { expiresAtMs, token } = await issueRememberedDevice({ applicationId, days: 30, digestSecret,
    factorId: factor.factorId, nowMs, store, subjectId: String(owner.id) });
  assert.equal(expiresAtMs, nowMs + 30 * 24 * 60 * 60 * 1000);

  const [row] = await sql`select token_digest from idoc.mfa_remembered_devices where user_id=${owner.id}`;
  assert.notEqual(row.token_digest, token);

  const valid = await verifyRememberedDevice({ applicationId, digestSecrets: [digestSecret],
    nowMs, store, subjectId: String(owner.id), token });
  assert.equal(valid, true);
});

test('verifyRememberedDevice rejects a wrong token, a wrong secret, an expired record, and a missing/empty token', async () => {
  const owner = await createUser();
  const factor = await activeFactor(String(owner.id));
  const { expiresAtMs, token } = await issueRememberedDevice({ applicationId, days: 1, digestSecret,
    factorId: factor.factorId, nowMs, store, subjectId: String(owner.id) });

  assert.equal(await verifyRememberedDevice({ applicationId, digestSecrets: [digestSecret], nowMs,
    store, subjectId: String(owner.id), token: 'wrong-token' }), false);
  assert.equal(await verifyRememberedDevice({ applicationId, digestSecrets: [randomBytes(32)], nowMs,
    store, subjectId: String(owner.id), token }), false);
  assert.equal(await verifyRememberedDevice({ applicationId, digestSecrets: [digestSecret],
    nowMs: expiresAtMs, store, subjectId: String(owner.id), token }), false);
  assert.equal(await verifyRememberedDevice({ applicationId, digestSecrets: [digestSecret], nowMs,
    store, subjectId: String(owner.id), token: null }), false);
  assert.equal(await verifyRememberedDevice({ applicationId, digestSecrets: [], nowMs,
    store, subjectId: String(owner.id), token }), false);
});

test('verifyRememberedDevice accepts a token digested under any configured rotation secret', async () => {
  const owner = await createUser();
  const factor = await activeFactor(String(owner.id));
  const retiredSecret = randomBytes(32);
  const { token } = await issueRememberedDevice({ applicationId, days: 30, digestSecret: retiredSecret,
    factorId: factor.factorId, nowMs, store, subjectId: String(owner.id) });
  // The active secret is tried first and misses; the still-configured retired secret (a key not yet
  // fully removed from rotation) must still be honored -- exactly the multi-key rotation story every
  // other digest/encryption secret in this codebase already supports.
  assert.equal(await verifyRememberedDevice({ applicationId, digestSecrets: [digestSecret, retiredSecret],
    nowMs, store, subjectId: String(owner.id), token }), true);
});

test('issueRememberedDevice rejects an out-of-range day count and an undersized digest secret before ever touching the database', async () => {
  const owner = await createUser();
  const factor = await activeFactor(String(owner.id));
  for (const days of [0, -1, 91, 1.5]) {
    await assert.rejects(issueRememberedDevice({ applicationId, days, digestSecret, factorId: factor.factorId,
      nowMs, store, subjectId: String(owner.id) }), /between 1 and 90 days/);
  }
  await assert.rejects(issueRememberedDevice({ applicationId, days: 30, digestSecret: randomBytes(16),
    factorId: factor.factorId, nowMs, store, subjectId: String(owner.id) }), /at least 32 bytes/);
  assert.equal((await sql`select count(*)::int as count from idoc.mfa_remembered_devices`)[0].count, 0);
});

test('replacing the bound TOTP factor invalidates a remembered device issued through issueRememberedDevice, not just one inserted directly', async () => {
  const owner = await createUser();
  const original = await activeFactor(String(owner.id));
  const { token } = await issueRememberedDevice({ applicationId, days: 30, digestSecret,
    factorId: original.factorId, nowMs, store, subjectId: String(owner.id) });
  assert.equal(await store.revokeFactor({ applicationId, factorId: original.factorId, nowMs, reason: 'replacement', subjectId: String(owner.id) }), true);
  assert.equal(await verifyRememberedDevice({ applicationId, digestSecrets: [digestSecret], nowMs,
    store, subjectId: String(owner.id), token }), false);
});
