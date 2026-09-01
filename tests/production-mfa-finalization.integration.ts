import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { finalizeInitialAuthenticatorEnrollment } from '../lib/auth/mfa/enrollment-finalization.ts';
import { finalizeAuthenticatorReplacement } from '../lib/auth/mfa/replacement-finalization.ts';
import { consumeRecoveryCodeWithEvidence } from '../lib/auth/mfa/recovery-security.ts';
import { regenerateRecoveryCodesWithEvidence } from '../lib/auth/mfa/recovery-regeneration.ts';
import type { RecoveryCodeRecord } from '../lib/auth/mfa/types.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

const applicationId = 'idoc-web';
const nowMs = 1_800_000_000_000;

beforeEach(resetIdoc);
after(closeHarness);

function codes(userId: number, generationId = randomUUID(), prefix = 'digest') {
  const records: RecoveryCodeRecord[] = Array.from({ length: 3 }, (_, index) => ({
    applicationId, consumedAtMs: null, createdAtMs: nowMs, digest: `${prefix}-${index}`,
    generationId, recoveryCodeId: randomUUID(), subjectId: String(userId),
  }));
  return { generationId, records };
}

async function pending(userId: number, purpose: 'mfa-enrollment' | 'authenticator-replacement', expiresAt = nowMs + 60_000) {
  const factorId = randomUUID();
  const transactionId = randomUUID();
  await sql`insert into idoc.mfa_factors
    (factor_id,user_id,application_id,factor_type,status,encrypted_secret,encryption_key_id)
    values(${factorId},${userId},${applicationId},'totp','pending','encrypted-secret','v1')`;
  await sql`insert into idoc.mfa_enrollment_transactions
    (transaction_id,user_id,application_id,factor_id,purpose,expires_at)
    values(${transactionId},${userId},${applicationId},${factorId},${purpose},${new Date(expiresAt).toISOString()})`;
  return { factorId, transactionId };
}

test('production initial finalizer is owner-bound, expiring, atomic, and single-use under concurrency', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const enrollment = await pending(owner.id, 'mfa-enrollment');
  const recovery = codes(owner.id);
  const input = { acceptedCounter: 10, applicationId, ...enrollment, nowMs,
    recoveryCodes: recovery.records, recoveryGenerationId: recovery.generationId, userId: owner.id };
  assert.deepEqual(await finalizeInitialAuthenticatorEnrollment({ ...input, userId: stranger.id }), { status: 'invalid-transaction' });
  const outcomes = await Promise.all([finalizeInitialAuthenticatorEnrollment(input), finalizeInitialAuthenticatorEnrollment(input)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'activated').length, 1);
  const [state] = await sql<{ active: number; codes: number; events: number }[]>`select
    (select count(*)::int from idoc.mfa_factors where user_id=${owner.id} and status='active') active,
    (select count(*)::int from idoc.mfa_recovery_codes where user_id=${owner.id}) codes,
    (select count(*)::int from idoc.audit_log where actor_id=${owner.id} and action='auth.mfa.authenticator.enrolled') events`;
  assert.deepEqual(state, { active: 1, codes: 3, events: 1 });
  const expired = await pending(stranger.id, 'mfa-enrollment', nowMs - 1);
  const expiredCodes = codes(stranger.id);
  assert.equal((await finalizeInitialAuthenticatorEnrollment({ acceptedCounter: 1, applicationId, ...expired, nowMs,
    recoveryCodes: expiredCodes.records, recoveryGenerationId: expiredCodes.generationId, userId: stranger.id })).status, 'invalid-transaction');
});

test('production recovery consumption has exactly one winner and secret-free evidence', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const recovery = codes(owner.id, randomUUID(), 'raw-code-must-not-appear');
  await regenerateRecoveryCodesWithEvidence({ applicationId, generationId: recovery.generationId,
    records: recovery.records, userId: owner.id }).then((result) => assert.equal(result, 'invalid'));
  await sql`insert into idoc.mfa_recovery_codes(recovery_code_id,user_id,application_id,generation_id,digest)
    values(${recovery.records[0].recoveryCodeId},${owner.id},${applicationId},${recovery.generationId},${recovery.records[0].digest})`;
  const base = { applicationId, dedupeKey: `consume:${randomUUID()}`, digests: [recovery.records[0].digest],
    nowMs, recipientEmail: owner.email, userId: owner.id };
  assert.equal(await consumeRecoveryCodeWithEvidence({ ...base, userId: stranger.id }), 'invalid');
  const outcomes = await Promise.all([consumeRecoveryCodeWithEvidence(base), consumeRecoveryCodeWithEvidence(base)]);
  assert.deepEqual(outcomes.sort(), ['consumed', 'invalid']);
  const evidence = JSON.stringify(await sql`select action,reason from idoc.audit_log where actor_id=${owner.id}
    union all select kind,dedupe_key from idoc.auth_security_notification_outbox where user_id=${owner.id}`);
  assert.doesNotMatch(evidence, /raw-code-must-not-appear/);
});

test('production replacement serializes competing confirmations and rotates all dependent authority', async () => {
  const owner = await createUser();
  const oldFactorId = randomUUID();
  await sql`insert into idoc.mfa_factors(factor_id,user_id,application_id,factor_type,status,encrypted_secret,encryption_key_id)
    values(${oldFactorId},${owner.id},${applicationId},'totp','active','old-encrypted','v1')`;
  await sql`insert into idoc.mfa_remembered_devices(remembered_device_id,user_id,application_id,factor_id,token_digest,expires_at)
    values(${randomUUID()},${owner.id},${applicationId},${oldFactorId},'old-device',${new Date(nowMs + 60_000).toISOString()})`;
  const candidates = await Promise.all([pending(owner.id, 'authenticator-replacement'), pending(owner.id, 'authenticator-replacement')]);
  const prepared = candidates.map((_, index) => codes(owner.id, randomUUID(), `new-${index}`));
  const outcomes = await Promise.all(candidates.map((candidate, index) => finalizeAuthenticatorReplacement({
    acceptedCounter: 20 + index, applicationId, expectedSessionVersion: 0, ...candidate, nowMs,
    recoveryCodes: prepared[index].records, recoveryGenerationId: prepared[index].generationId, userId: owner.id,
  })));
  assert.equal(outcomes.filter((outcome) => outcome.status === 'activated').length, 1);
  const [state] = await sql<{ active: number; codes: number; events: number; revokedDevices: number; version: number }[]>`select
    (select count(*)::int from idoc.mfa_factors where user_id=${owner.id} and status='active') active,
    (select count(*)::int from idoc.mfa_recovery_codes where user_id=${owner.id}) codes,
    (select count(*)::int from idoc.audit_log where actor_id=${owner.id} and action='auth.mfa.authenticator.replaced') events,
    (select count(*)::int from idoc.mfa_remembered_devices where user_id=${owner.id} and revoked_at is not null) "revokedDevices",
    (select session_version::int from idoc.users where id=${owner.id}) version`;
  assert.deepEqual(state, { active: 1, codes: 3, events: 1, revokedDevices: 1, version: 1 });
});

test('standalone production regeneration atomically replaces the generation and leaves no plaintext evidence', async () => {
  const owner = await createUser();
  await sql`insert into idoc.mfa_factors(factor_id,user_id,application_id,factor_type,status,encrypted_secret,encryption_key_id)
    values(${randomUUID()},${owner.id},${applicationId},'totp','active','encrypted','v1')`;
  const old = codes(owner.id, randomUUID(), 'old');
  assert.equal(await regenerateRecoveryCodesWithEvidence({ applicationId, generationId: old.generationId,
    records: old.records, userId: owner.id }), 'regenerated');
  const next = codes(owner.id, randomUUID(), 'new');
  assert.equal(await regenerateRecoveryCodesWithEvidence({ applicationId, generationId: next.generationId,
    records: next.records, userId: owner.id }), 'regenerated');
  const rows = await sql<{ digest: string; generation_id: string }[]>`select digest,generation_id from idoc.mfa_recovery_codes where user_id=${owner.id}`;
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.generation_id === next.generationId && row.digest.startsWith('new-')));
});
