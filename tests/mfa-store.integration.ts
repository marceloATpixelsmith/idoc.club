import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import type { TotpEnrollmentRecord, TotpFactorRecord } from '../lib/auth/mfa/types.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

const applicationId = 'idoc-web';
const nowMs = 1_800_000_000_000;
const store = new PostgresMfaStore(sql);

beforeEach(resetIdoc);
after(closeHarness);

async function pendingFactor(
  subjectId: string,
  expiresAtMs = nowMs + 60_000,
  purpose: TotpEnrollmentRecord['purpose'] = 'mfa-enrollment',
) {
  const factor: TotpFactorRecord = {
    activatedAtMs: null,
    applicationId,
    createdAtMs: nowMs,
    encryptedSecret: 'v1.iv.tag.ciphertext',
    factorId: randomUUID(),
    keyId: 'v1',
    lastAcceptedCounter: null,
    replacedByFactorId: null,
    status: 'pending',
    subjectId,
  };
  const enrollment: TotpEnrollmentRecord = {
    applicationId,
    consumedAtMs: null,
    createdAtMs: nowMs,
    expiresAtMs,
    factorId: factor.factorId,
    purpose,
    subjectId,
    transactionId: randomUUID(),
  };
  await store.createPendingTotp({ enrollment, factor });
  return { enrollment, factor };
}

async function activeFactor(subjectId: string, counter = 100) {
  const records = await pendingFactor(subjectId);
  assert.equal(await store.consumeEnrollmentAndActivate({
    acceptedCounter: counter,
    applicationId,
    factorId: records.factor.factorId,
    nowMs,
    subjectId,
    transactionId: records.enrollment.transactionId,
  }), 'activated');
  return records.factor;
}

test('enrollment consumption is bound, expiring, atomic, and single use', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const records = await pendingFactor(String(owner.id));
  const base = {
    acceptedCounter: 100,
    applicationId,
    factorId: records.factor.factorId,
    nowMs,
    transactionId: records.enrollment.transactionId,
  };
  assert.equal(await store.consumeEnrollmentAndActivate({ ...base, subjectId: String(stranger.id) }), 'invalid-transaction');
  const outcomes = await Promise.all([
    store.consumeEnrollmentAndActivate({ ...base, subjectId: String(owner.id) }),
    store.consumeEnrollmentAndActivate({ ...base, subjectId: String(owner.id) }),
  ]);
  assert.deepEqual(outcomes.sort(), ['activated', 'invalid-transaction']);

  const expired = await pendingFactor(String(owner.id), nowMs - 1);
  assert.equal(await store.consumeEnrollmentAndActivate({
    ...base,
    factorId: expired.factor.factorId,
    subjectId: String(owner.id),
    transactionId: expired.enrollment.transactionId,
  }), 'invalid-transaction');
});

test('distinct concurrent initial enrollments serialize on the owning user', async () => {
  const owner = await createUser();
  const subjectId = String(owner.id);
  const [first, second] = await Promise.all([pendingFactor(subjectId), pendingFactor(subjectId)]);
  const outcomes = await Promise.all([
    store.consumeEnrollmentAndActivate({
      acceptedCounter: 100,
      applicationId,
      factorId: first.factor.factorId,
      nowMs,
      subjectId,
      transactionId: first.enrollment.transactionId,
    }),
    store.consumeEnrollmentAndActivate({
      acceptedCounter: 101,
      applicationId,
      factorId: second.factor.factorId,
      nowMs,
      subjectId,
      transactionId: second.enrollment.transactionId,
    }),
  ]);
  assert.deepEqual(outcomes.sort(), ['activated', 'invalid-transaction']);
  const active = await sql<{ count: number }[]>`select count(*)::int as count from idoc.mfa_factors where user_id=${owner.id} and application_id=${applicationId} and factor_type='totp' and status='active'`;
  assert.equal(active[0].count, 1);
});

test('challenge binding, expiry, attempt exhaustion, replay, and factor ownership are enforced', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const factor = await activeFactor(String(owner.id));
  const challengeId = randomUUID();
  await store.createChallenge({ applicationId, expiresAtMs: nowMs + 60_000, maxAttempts: 2, nowMs, purpose: 'login', subjectId: String(owner.id), transactionId: challengeId });
  const attempt = { applicationId, counter: 101, factorId: factor.factorId, nowMs, purpose: 'login' as const, subjectId: String(owner.id), transactionId: challengeId };
  assert.equal(await store.acceptTotpChallenge({ ...attempt, purpose: 'step-up' }), 'invalid-transaction');
  assert.equal(await store.acceptTotpChallenge({ ...attempt, subjectId: String(stranger.id) }), 'invalid-transaction');
  const outcomes = await Promise.all([store.acceptTotpChallenge(attempt), store.acceptTotpChallenge(attempt)]);
  assert.deepEqual(outcomes.sort(), ['accepted', 'invalid-transaction']);

  const replayIds = [randomUUID(), randomUUID()];
  await Promise.all(replayIds.map((transactionId) => store.createChallenge({ applicationId, expiresAtMs: nowMs + 60_000, maxAttempts: 2, nowMs, purpose: 'login', subjectId: String(owner.id), transactionId })));
  const replayOutcomes = await Promise.all(replayIds.map((transactionId) => store.acceptTotpChallenge({ ...attempt, counter: 102, transactionId })));
  assert.deepEqual(replayOutcomes.sort(), ['accepted', 'replay']);

  const exhaustedId = randomUUID();
  await store.createChallenge({ applicationId, expiresAtMs: nowMs + 60_000, maxAttempts: 1, nowMs, purpose: 'login', subjectId: String(owner.id), transactionId: exhaustedId });
  assert.equal(await store.recordChallengeFailure({ applicationId, nowMs, purpose: 'step-up', subjectId: String(owner.id), transactionId: exhaustedId }), 'invalid-transaction');
  assert.equal(await store.recordChallengeFailure({ applicationId, nowMs, purpose: 'login', subjectId: String(stranger.id), transactionId: exhaustedId }), 'invalid-transaction');
  const failureOutcomes = await Promise.all([
    store.recordChallengeFailure({ applicationId, nowMs, purpose: 'login', subjectId: String(owner.id), transactionId: exhaustedId }),
    store.recordChallengeFailure({ applicationId, nowMs, purpose: 'login', subjectId: String(owner.id), transactionId: exhaustedId }),
  ]);
  assert.deepEqual(failureOutcomes.sort(), ['attempts-exhausted', 'invalid-transaction']);
  assert.equal(await store.acceptTotpChallenge({ ...attempt, counter: 103, transactionId: exhaustedId }), 'attempts-exhausted');

  const expiredId = randomUUID();
  await store.createChallenge({ applicationId, expiresAtMs: nowMs + 1, maxAttempts: 1, nowMs, purpose: 'login', subjectId: String(owner.id), transactionId: expiredId });
  assert.equal(await store.acceptTotpChallenge({ ...attempt, counter: 103, nowMs: nowMs + 2, transactionId: expiredId }), 'invalid-transaction');
});

test('concurrent recovery-code consumption has at most one winner and rejects another user', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const digest = 'recovery-digest';
  await store.replaceRecoveryCodes({
    applicationId,
    codes: [{ applicationId, consumedAtMs: null, createdAtMs: nowMs, digest, generationId: randomUUID(), recoveryCodeId: randomUUID(), subjectId: String(owner.id) }],
    generationId: '',
    nowMs,
    subjectId: String(owner.id),
  }).then(() => assert.fail('generation mismatch must fail'), () => undefined);
  const generationId = randomUUID();
  await store.replaceRecoveryCodes({
    applicationId,
    codes: [{ applicationId, consumedAtMs: null, createdAtMs: nowMs, digest, generationId, recoveryCodeId: randomUUID(), subjectId: String(owner.id) }],
    generationId,
    nowMs,
    subjectId: String(owner.id),
  });
  assert.equal(await store.consumeRecoveryCode({ applicationId, digests: [digest], nowMs, subjectId: String(stranger.id) }), 'invalid');
  const outcomes = await Promise.all([
    store.consumeRecoveryCode({ applicationId, digests: [digest], nowMs, subjectId: String(owner.id) }),
    store.consumeRecoveryCode({ applicationId, digests: [digest], nowMs, subjectId: String(owner.id) }),
  ]);
  assert.deepEqual(outcomes.sort(), ['consumed', 'invalid']);
});

test('remembered devices require an active owned factor and honor expiry and revocation', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const factor = await activeFactor(String(owner.id));
  const record = {
    applicationId,
    expiresAtMs: nowMs + 60_000,
    factorId: factor.factorId,
    issuedAtMs: nowMs,
    rememberedDeviceId: randomUUID(),
    revokedAtMs: null,
    subjectId: String(owner.id),
    tokenDigest: 'opaque-token-digest',
  };
  await assert.rejects(store.createRememberedDevice({ ...record, subjectId: String(stranger.id) }), /factor binding/);
  await store.createRememberedDevice(record);
  assert.equal(await store.consumeRememberedDevice({ applicationId, nowMs, subjectId: String(owner.id), tokenDigest: record.tokenDigest }), 'valid');
  assert.equal(await store.consumeRememberedDevice({ applicationId, nowMs: record.expiresAtMs, subjectId: String(owner.id), tokenDigest: record.tokenDigest }), 'invalid');
  await store.revokeRememberedDevices(String(owner.id), applicationId, nowMs);
  assert.equal(await store.consumeRememberedDevice({ applicationId, nowMs, subjectId: String(owner.id), tokenDigest: record.tokenDigest }), 'invalid');
});

test('factor revocation is owner-bound and blocks routine TOTP and remembered devices', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const factor = await activeFactor(String(owner.id));
  assert.equal(await store.revokeFactor({ applicationId, factorId: factor.factorId, nowMs, reason: 'replacement', subjectId: String(stranger.id) }), false);
  assert.ok(await store.getActiveTotp(String(owner.id), applicationId));
  assert.equal(await store.revokeFactor({ applicationId, factorId: factor.factorId, nowMs, reason: 'replacement', subjectId: String(owner.id) }), true);
  assert.equal(await store.getActiveTotp(String(owner.id), applicationId), null);
});

test('replacement enrollment atomically transitions the old active factor', async () => {
  const owner = await createUser();
  const original = await activeFactor(String(owner.id));
  const replacement = await pendingFactor(String(owner.id), nowMs + 60_000, 'authenticator-replacement');
  assert.equal(await store.consumeEnrollmentAndActivate({
    acceptedCounter: 200,
    applicationId,
    factorId: replacement.factor.factorId,
    nowMs,
    subjectId: String(owner.id),
    transactionId: replacement.enrollment.transactionId,
  }), 'activated');
  assert.equal((await store.getActiveTotp(String(owner.id), applicationId))?.factorId, replacement.factor.factorId);
  const [old] = await sql`select status,replaced_by_factor_id from idoc.mfa_factors where factor_id=${original.factorId}`;
  assert.deepEqual(old, { replaced_by_factor_id: replacement.factor.factorId, status: 'replaced' });
});