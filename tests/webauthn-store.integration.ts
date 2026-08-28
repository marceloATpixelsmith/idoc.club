import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { PostgresMfaStore } from '../lib/auth/mfa/store.ts';
import { PostgresWebAuthnStore } from '../lib/auth/mfa/webauthn-store.ts';
import type { TotpEnrollmentRecord, TotpFactorRecord } from '../lib/auth/mfa/types.ts';
import { closeHarness, concurrently, createUser, resetIdoc, sql } from './postgres-harness.ts';

const applicationId = 'idoc-web';
const nowMs = 1_800_000_000_000;
const mfaStore = new PostgresMfaStore(sql);
const webauthnStore = new PostgresWebAuthnStore(sql);

beforeEach(resetIdoc);
after(closeHarness);

async function activeTotpFactor(subjectId: string) {
  const factor: TotpFactorRecord = {
    activatedAtMs: null, applicationId, createdAtMs: nowMs, encryptedSecret: 'v1.iv.tag.ciphertext',
    factorId: randomUUID(), keyId: 'v1', lastAcceptedCounter: null, replacedByFactorId: null,
    status: 'pending', subjectId,
  };
  const enrollment: TotpEnrollmentRecord = {
    applicationId, consumedAtMs: null, createdAtMs: nowMs, expiresAtMs: nowMs + 60_000,
    factorId: factor.factorId, purpose: 'mfa-enrollment', subjectId, transactionId: randomUUID(),
  };
  await mfaStore.createPendingTotp({ enrollment, factor });
  assert.equal(await mfaStore.consumeEnrollmentAndActivate({
    acceptedCounter: 1, applicationId, factorId: factor.factorId, nowMs, subjectId, transactionId: enrollment.transactionId,
  }), 'activated');
}

function credentialInput(overrides: Partial<Parameters<typeof webauthnStore.createCredential>[0]> = {}) {
  return {
    subjectId: '0', applicationId, credentialId: randomUUID(), publicKey: 'base64url-public-key-material',
    signCount: 0, transports: ['internal'], deviceType: 'singleDevice' as const, backedUp: false,
    deviceName: 'Test device', nowMs, ...overrides,
  };
}

test('a WebAuthn credential can only be registered for a subject that already has an active TOTP factor', async () => {
  const owner = await createUser();
  const result = await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id) }));
  assert.equal(result.status, 'no-totp-fallback');
  assert.equal((await webauthnStore.getActiveCredentials(String(owner.id), applicationId)).length, 0);

  await activeTotpFactor(String(owner.id));
  const created = await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id) }));
  assert.equal(created.status, 'created');
});

test('a duplicate credential ID is rejected rather than silently overwriting an existing registration', async () => {
  const owner = await createUser();
  await activeTotpFactor(String(owner.id));
  const credentialId = randomUUID();
  assert.equal((await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id), credentialId }))).status, 'created');
  const second = await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id), credentialId }));
  assert.equal(second.status, 'duplicate-credential');
});

test('a subject may register several active WebAuthn credentials at once, unlike the single-active-TOTP invariant', async () => {
  const owner = await createUser();
  await activeTotpFactor(String(owner.id));
  await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id) }));
  await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id) }));
  const active = await webauthnStore.getActiveCredentials(String(owner.id), applicationId);
  assert.equal(active.length, 2);
});

test('getActiveCredentialById never returns another subject\'s credential', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  await activeTotpFactor(String(owner.id));
  await activeTotpFactor(String(stranger.id));
  const credentialId = randomUUID();
  await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id), credentialId }));
  assert.ok(await webauthnStore.getActiveCredentialById(credentialId, String(owner.id), applicationId));
  assert.equal(await webauthnStore.getActiveCredentialById(credentialId, String(stranger.id), applicationId), null);
});

test('updateSignCount accepts a strictly increasing counter and rejects a non-increasing one as a cloned-authenticator signal', async () => {
  const owner = await createUser();
  await activeTotpFactor(String(owner.id));
  const credentialId = randomUUID();
  await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id), credentialId, signCount: 5 }));

  assert.equal(await webauthnStore.updateSignCount({ credentialId, subjectId: String(owner.id), applicationId, newCount: 6, nowMs }), true);
  const [afterFirst] = await webauthnStore.getActiveCredentials(String(owner.id), applicationId);
  assert.equal(afterFirst.signCount, 6);

  assert.equal(await webauthnStore.updateSignCount({ credentialId, subjectId: String(owner.id), applicationId, newCount: 6, nowMs }), false);
  assert.equal(await webauthnStore.updateSignCount({ credentialId, subjectId: String(owner.id), applicationId, newCount: 3, nowMs }), false);
  const [afterReplay] = await webauthnStore.getActiveCredentials(String(owner.id), applicationId);
  assert.equal(afterReplay.signCount, 6, 'a rejected update must not have mutated the stored counter');
});

test('updateSignCount tolerates authenticators that always report a zero counter, per the WebAuthn spec allowance', async () => {
  const owner = await createUser();
  await activeTotpFactor(String(owner.id));
  const credentialId = randomUUID();
  await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id), credentialId, signCount: 0 }));
  assert.equal(await webauthnStore.updateSignCount({ credentialId, subjectId: String(owner.id), applicationId, newCount: 0, nowMs }), true);
  assert.equal(await webauthnStore.updateSignCount({ credentialId, subjectId: String(owner.id), applicationId, newCount: 0, nowMs }), true);
});

test('revokeCredential only removes the caller\'s own credential and cannot be repeated', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  await activeTotpFactor(String(owner.id));
  const credentialId = randomUUID();
  await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id), credentialId }));

  assert.equal(await webauthnStore.revokeCredential({ credentialId, subjectId: String(stranger.id), applicationId, reason: 'user_removed', nowMs }), false);
  assert.equal(await webauthnStore.revokeCredential({ credentialId, subjectId: String(owner.id), applicationId, reason: 'user_removed', nowMs }), true);
  assert.equal(await webauthnStore.getActiveCredentialById(credentialId, String(owner.id), applicationId), null);
  assert.equal(await webauthnStore.revokeCredential({ credentialId, subjectId: String(owner.id), applicationId, reason: 'user_removed', nowMs }), false);
});

test('a ceremony challenge is single-use, purpose-bound, and rejects a mismatched subject or expired challenge', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const ceremonyId = await webauthnStore.createCeremonyChallenge({
    subjectId: String(owner.id), applicationId, purpose: 'registration', challenge: 'challenge-bytes', expiresAtMs: nowMs + 60_000, nowMs,
  });

  assert.equal(await webauthnStore.consumeCeremonyChallenge({ ceremonyId, subjectId: String(stranger.id), applicationId, purpose: 'registration', nowMs }), null);
  assert.equal(await webauthnStore.consumeCeremonyChallenge({ ceremonyId, subjectId: String(owner.id), applicationId, purpose: 'authentication', nowMs }), null);
  assert.equal(await webauthnStore.consumeCeremonyChallenge({ ceremonyId, subjectId: String(owner.id), applicationId, purpose: 'registration', nowMs: nowMs + 120_000 }), null);
  assert.equal(await webauthnStore.consumeCeremonyChallenge({ ceremonyId, subjectId: String(owner.id), applicationId, purpose: 'registration', nowMs }), 'challenge-bytes');
  assert.equal(await webauthnStore.consumeCeremonyChallenge({ ceremonyId, subjectId: String(owner.id), applicationId, purpose: 'registration', nowMs }), null, 'a consumed challenge must not be usable twice');
});

test('two concurrent registrations racing to claim the same credential ID resolve to exactly one winner', async () => {
  const owner = await createUser();
  await activeTotpFactor(String(owner.id));
  const credentialId = randomUUID();
  const outcomes = await concurrently(
    () => webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id), credentialId })),
    () => webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id), credentialId })),
  );
  const statuses = outcomes.map((outcome) => outcome.status === 'fulfilled' ? outcome.value.status : 'rejected').sort();
  assert.deepEqual(statuses, ['created', 'duplicate-credential']);
  assert.equal((await webauthnStore.getActiveCredentials(String(owner.id), applicationId)).length, 1);
});

test('acceptChallengeWithVerifiedFactor on the shared MFA store completes a login challenge for a WebAuthn factor without a TOTP counter', async () => {
  const owner = await createUser();
  await activeTotpFactor(String(owner.id));
  const credentialId = randomUUID();
  const created = await webauthnStore.createCredential(credentialInput({ subjectId: String(owner.id), credentialId }));
  assert.equal(created.status, 'created');
  if (created.status !== 'created') return;

  const transactionId = randomUUID();
  await mfaStore.createChallenge({ transactionId, subjectId: String(owner.id), applicationId, purpose: 'login', expiresAtMs: nowMs + 60_000, maxAttempts: 5, nowMs });

  const wrongFactor = await mfaStore.acceptChallengeWithVerifiedFactor({ transactionId, purpose: 'login', factorId: randomUUID(), subjectId: String(owner.id), applicationId, nowMs });
  assert.equal(wrongFactor, 'inactive');

  const accepted = await mfaStore.acceptChallengeWithVerifiedFactor({ transactionId, purpose: 'login', factorId: created.factorId, subjectId: String(owner.id), applicationId, nowMs });
  assert.equal(accepted, 'accepted');

  const replay = await mfaStore.acceptChallengeWithVerifiedFactor({ transactionId, purpose: 'login', factorId: created.factorId, subjectId: String(owner.id), applicationId, nowMs });
  assert.equal(replay, 'invalid-transaction', 'a consumed challenge transaction must not be satisfiable twice');
});
