import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { finalizeInitialAuthenticatorEnrollment } from '../lib/auth/mfa/enrollment-finalization.ts';
import { finalizeAuthenticatorReplacement } from '../lib/auth/mfa/replacement-finalization.ts';
import { consumeRecoveryCodeAndBeginReplacement } from '../lib/auth/mfa/recovery-security.ts';
import { regenerateRecoveryCodesWithEvidence } from '../lib/auth/mfa/recovery-regeneration.ts';
import { prepareTotpEnrollment } from '../lib/auth/mfa/totp.ts';
import type { RecoveryCodeRecord } from '../lib/auth/mfa/types.ts';
import { closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

const applicationId = 'idoc-web';
const nowMs = 1_800_000_000_000;
const recoveryAckTtlMs = 10 * 60 * 1000;

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
  const [notification] = await sql<{ kind: string; recipient_email: string }[]>`select kind,recipient_email
    from idoc.auth_security_notification_outbox where user_id=${owner.id}`;
  assert.deepEqual(notification, { kind: 'authenticator_enrolled', recipient_email: owner.email });
  const [ackWindow] = await sql<{ expires_at: string | Date }[]>`select expires_at from idoc.mfa_enrollment_transactions
    where transaction_id=${enrollment.transactionId}`;
  assert.equal(new Date(ackWindow.expires_at).getTime(), nowMs + recoveryAckTtlMs);
  const expired = await pending(stranger.id, 'mfa-enrollment', nowMs - 1);
  const expiredCodes = codes(stranger.id);
  assert.equal((await finalizeInitialAuthenticatorEnrollment({ acceptedCounter: 1, applicationId, ...expired, nowMs,
    recoveryCodes: expiredCodes.records, recoveryGenerationId: expiredCodes.generationId, userId: stranger.id })).status, 'invalid-transaction');
});

test('production recovery consumption has exactly one winner and secret-free evidence', async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const recovery = codes(owner.id, randomUUID(), 'raw-code-must-not-appear');
  await regenerateRecoveryCodesWithEvidence({ applicationId, expectedSessionVersion: 0, generationId: recovery.generationId,
    records: recovery.records, userId: owner.id }).then((result) => assert.equal(result, 'invalid'));
  await sql`insert into idoc.mfa_recovery_codes(recovery_code_id,user_id,application_id,generation_id,digest)
    values(${recovery.records[0].recoveryCodeId},${owner.id},${applicationId},${recovery.generationId},${recovery.records[0].digest})`;
  const base = { applicationId, dedupeKey: `consume:${randomUUID()}`, digests: [recovery.records[0].digest],
    ...prepareTotpEnrollment({ accountLabel: owner.email, applicationId, encryptionKey: randomBytes(32),
      issuer: 'IDOC', keyId: 'v1', nowMs, purpose: 'authenticator-replacement', subjectId: String(owner.id) }),
    nowMs, recipientEmail: owner.email, userId: owner.id };
  assert.equal(await consumeRecoveryCodeAndBeginReplacement({ ...base, userId: stranger.id }), 'invalid');
  const outcomes = await Promise.all([consumeRecoveryCodeAndBeginReplacement(base), consumeRecoveryCodeAndBeginReplacement(base)]);
  assert.deepEqual(outcomes.sort(), ['consumed', 'invalid']);
  const evidence = JSON.stringify(await sql`select action,reason from idoc.audit_log where actor_id=${owner.id}
    union all select kind,dedupe_key from idoc.auth_security_notification_outbox where user_id=${owner.id}`);
  assert.doesNotMatch(evidence, /raw-code-must-not-appear/);
  const [notification] = await sql<{ kind: string; recipient_email: string }[]>`select kind,recipient_email
    from idoc.auth_security_notification_outbox where user_id=${owner.id}`;
  assert.deepEqual(notification, { kind: 'recovery_code_used', recipient_email: owner.email });
});

test('production recovery keeps the code usable when replacement setup cannot commit', async () => {
  const owner = await createUser();
  const recovery = codes(owner.id, randomUUID(), 'rollback-code');
  await sql`insert into idoc.mfa_recovery_codes(recovery_code_id,user_id,application_id,generation_id,digest)
    values(${recovery.records[0].recoveryCodeId},${owner.id},${applicationId},${recovery.generationId},${recovery.records[0].digest})`;
  const prepared = prepareTotpEnrollment({ accountLabel: owner.email, applicationId, encryptionKey: randomBytes(32),
    issuer: 'IDOC', keyId: 'v1', nowMs, purpose: 'authenticator-replacement', subjectId: String(owner.id) });

  await assert.rejects(consumeRecoveryCodeAndBeginReplacement({ applicationId, dedupeKey: `rollback:${randomUUID()}`,
    digests: [recovery.records[0].digest], enrollment: prepared.enrollment, factor: prepared.factor,
    nowMs, recipientEmail: `${'x'.repeat(300)}@example.test`, userId: owner.id }));

  const [state] = await sql<{ consumed: boolean; enrollments: number; factors: number }[]>`select
    (select consumed_at is not null from idoc.mfa_recovery_codes where recovery_code_id=${recovery.records[0].recoveryCodeId}) consumed,
    (select count(*)::int from idoc.mfa_enrollment_transactions where transaction_id=${prepared.transactionId}) enrollments,
    (select count(*)::int from idoc.mfa_factors where factor_id=${prepared.factorId}) factors`;
  assert.deepEqual(state, { consumed: false, enrollments: 0, factors: 0 });
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
  const [notification] = await sql<{ kind: string; recipient_email: string }[]>`select kind,recipient_email
    from idoc.auth_security_notification_outbox where user_id=${owner.id}`;
  assert.deepEqual(notification, { kind: 'authenticator_replaced', recipient_email: owner.email });
  const [ackWindow] = await sql<{ expires_at: string | Date }[]>`select expires_at from idoc.mfa_enrollment_transactions
    where transaction_id in ${sql(candidates.map((candidate) => candidate.transactionId))} and consumed_at is not null`;
  assert.equal(new Date(ackWindow.expires_at).getTime(), nowMs + recoveryAckTtlMs);
});

test('standalone production regeneration atomically replaces the generation and leaves no plaintext evidence', async () => {
  const owner = await createUser();
  await sql`insert into idoc.mfa_factors(factor_id,user_id,application_id,factor_type,status,encrypted_secret,encryption_key_id)
    values(${randomUUID()},${owner.id},${applicationId},'totp','active','encrypted','v1')`;
  const old = codes(owner.id, randomUUID(), 'old');
  assert.equal(await regenerateRecoveryCodesWithEvidence({ applicationId, expectedSessionVersion: 0, generationId: old.generationId,
    records: old.records, userId: owner.id }), 'regenerated');
  await sql`update idoc.users set session_version=1 where id=${owner.id}`;
  const stale = codes(owner.id, randomUUID(), 'stale');
  assert.equal(await regenerateRecoveryCodesWithEvidence({ applicationId, expectedSessionVersion: 0, generationId: stale.generationId,
    records: stale.records, userId: owner.id }), 'invalid');
  await sql`update idoc.users set session_version=0 where id=${owner.id}`;
  const next = codes(owner.id, randomUUID(), 'new');
  assert.equal(await regenerateRecoveryCodesWithEvidence({ applicationId, expectedSessionVersion: 0, generationId: next.generationId,
    records: next.records, userId: owner.id }), 'regenerated');
  const rows = await sql<{ digest: string; generation_id: string }[]>`select digest,generation_id from idoc.mfa_recovery_codes where user_id=${owner.id}`;
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.generation_id === next.generationId && row.digest.startsWith('new-')));
});
