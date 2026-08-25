import 'server-only';
import type postgres from 'postgres';
import { client } from '../../db/drizzle.ts';
import type {
  MfaChallengePurpose,
  MfaStore,
  RecoveryCodeRecord,
  RememberedDeviceRecord,
  TotpEnrollmentRecord,
  TotpFactorRecord,
} from './types.ts';

type Sql = ReturnType<typeof postgres>;

function userId(subjectId: string): number | null {
  if (!/^[1-9]\d*$/.test(subjectId)) return null;
  const parsed = Number(subjectId);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function date(ms: number): Date {
  return new Date(ms);
}

function factorRecord(row: Record<string, unknown>): TotpFactorRecord {
  return {
    factorId: String(row.factor_id),
    subjectId: String(row.user_id),
    applicationId: String(row.application_id),
    status: row.status as TotpFactorRecord['status'],
    encryptedSecret: String(row.encrypted_secret),
    keyId: String(row.encryption_key_id),
    createdAtMs: (row.created_at as Date).getTime(),
    activatedAtMs: row.activated_at ? (row.activated_at as Date).getTime() : null,
    replacedByFactorId: row.replaced_by_factor_id ? String(row.replaced_by_factor_id) : null,
    lastAcceptedCounter: row.last_accepted_counter === null ? null : Number(row.last_accepted_counter),
  };
}

function enrollmentRecord(row: Record<string, unknown>): TotpEnrollmentRecord {
  return {
    transactionId: String(row.transaction_id),
    subjectId: String(row.user_id),
    applicationId: String(row.application_id),
    factorId: String(row.factor_id),
    purpose: row.purpose as TotpEnrollmentRecord['purpose'],
    createdAtMs: (row.created_at as Date).getTime(),
    expiresAtMs: (row.expires_at as Date).getTime(),
    consumedAtMs: row.consumed_at ? (row.consumed_at as Date).getTime() : null,
  };
}

/** PostgreSQL implementation of the canonical runtime contract.
 *
 * Subject IDs are translated to IDOC integer user IDs only at this trusted server boundary.
 * Security-sensitive state changes lock their transaction and re-check every binding while locked.
 */
export class PostgresMfaStore implements MfaStore {
  private readonly sql: Sql;

  constructor(sql: Sql = client) {
    this.sql = sql;
  }

  async createPendingTotp(input: { factor: TotpFactorRecord; enrollment: TotpEnrollmentRecord }): Promise<void> {
    const id = userId(input.factor.subjectId);
    if (id === null || input.enrollment.subjectId !== input.factor.subjectId ||
      input.enrollment.applicationId !== input.factor.applicationId || input.enrollment.factorId !== input.factor.factorId) {
      throw new Error('Invalid MFA enrollment binding.');
    }
    await this.sql.begin(async (tx) => {
      await tx`insert into idoc.mfa_factors
        (factor_id,user_id,application_id,status,encrypted_secret,encryption_key_id,last_accepted_counter,
         activated_at,replaced_by_factor_id,created_at,updated_at)
        values (${input.factor.factorId},${id},${input.factor.applicationId},${input.factor.status},
          ${input.factor.encryptedSecret},${input.factor.keyId},${input.factor.lastAcceptedCounter},
          ${input.factor.activatedAtMs === null ? null : date(input.factor.activatedAtMs)},
          ${input.factor.replacedByFactorId},${date(input.factor.createdAtMs)},${date(input.factor.createdAtMs)})`;
      await tx`insert into idoc.mfa_enrollment_transactions
        (transaction_id,user_id,application_id,factor_id,purpose,expires_at,consumed_at,created_at)
        values (${input.enrollment.transactionId},${id},${input.enrollment.applicationId},${input.enrollment.factorId},
          ${input.enrollment.purpose},${date(input.enrollment.expiresAtMs)},
          ${input.enrollment.consumedAtMs === null ? null : date(input.enrollment.consumedAtMs)},
          ${date(input.enrollment.createdAtMs)})`;
    });
  }

  async getPendingTotpEnrollment(input: { transactionId: string; subjectId: string; applicationId: string; factorId: string; nowMs: number }) {
    const id = userId(input.subjectId);
    if (id === null) return null;
    const rows = await this.sql<Record<string, unknown>[]>`
      select f.*, e.transaction_id, e.purpose, e.expires_at, e.consumed_at, e.created_at as enrollment_created_at
      from idoc.mfa_enrollment_transactions e
      join idoc.mfa_factors f on f.factor_id=e.factor_id and f.user_id=e.user_id and f.application_id=e.application_id
      where e.transaction_id=${input.transactionId} and e.user_id=${id} and e.application_id=${input.applicationId}
        and e.factor_id=${input.factorId} and e.consumed_at is null and e.expires_at>${date(input.nowMs)}
      limit 1`;
    const row = rows[0];
    if (!row) return null;
    return {
      factor: factorRecord(row),
      enrollment: enrollmentRecord({ ...row, created_at: row.enrollment_created_at }),
    };
  }

  async consumeEnrollmentAndActivate(input: { transactionId: string; subjectId: string; applicationId: string; factorId: string; acceptedCounter: number; nowMs: number }) {
    const id = userId(input.subjectId);
    if (id === null) return 'invalid-transaction' as const;
    return this.sql.begin(async (tx) => {
      const [enrollment] = await tx<Record<string, unknown>[]>`
        select * from idoc.mfa_enrollment_transactions where transaction_id=${input.transactionId} for update`;
      if (!enrollment || Number(enrollment.user_id) !== id || enrollment.application_id !== input.applicationId ||
        enrollment.factor_id !== input.factorId || enrollment.consumed_at ||
        (enrollment.expires_at as Date).getTime() <= input.nowMs) return 'invalid-transaction' as const;
      const [factor] = await tx<Record<string, unknown>[]>`
        select * from idoc.mfa_factors where factor_id=${input.factorId} for update`;
      if (!factor || Number(factor.user_id) !== id || factor.application_id !== input.applicationId || factor.status !== 'pending') {
        return 'invalid-transaction' as const;
      }
      if (factor.last_accepted_counter !== null && Number(factor.last_accepted_counter) >= input.acceptedCounter) return 'replay' as const;
      const [activeFactor] = await tx<Record<string, unknown>[]>`
        select * from idoc.mfa_factors where user_id=${id} and application_id=${input.applicationId}
          and factor_type='totp' and status='active' for update`;
      if (activeFactor && enrollment.purpose === 'mfa-enrollment') return 'invalid-transaction' as const;
      if (activeFactor) {
        await tx`update idoc.mfa_factors set status='replaced', replaced_by_factor_id=${input.factorId},
          revoked_at=${date(input.nowMs)}, lifecycle_reason='authenticator_replacement', updated_at=${date(input.nowMs)}
          where factor_id=${String(activeFactor.factor_id)}`;
        await tx`update idoc.mfa_remembered_devices set revoked_at=${date(input.nowMs)}, revoke_reason='factor_replaced'
          where factor_id=${String(activeFactor.factor_id)} and revoked_at is null`;
      }
      await tx`update idoc.mfa_enrollment_transactions set consumed_at=${date(input.nowMs)} where transaction_id=${input.transactionId}`;
      await tx`update idoc.mfa_factors set status='active', activated_at=${date(input.nowMs)},
        last_accepted_counter=${input.acceptedCounter}, updated_at=${date(input.nowMs)} where factor_id=${input.factorId}`;
      return 'activated' as const;
    });
  }

  async getActiveTotp(subjectId: string, applicationId: string): Promise<TotpFactorRecord | null> {
    const id = userId(subjectId);
    if (id === null) return null;
    const [row] = await this.sql<Record<string, unknown>[]>`
      select * from idoc.mfa_factors where user_id=${id} and application_id=${applicationId}
        and factor_type='totp' and status='active' limit 1`;
    return row ? factorRecord(row) : null;
  }

  async acceptTotpChallenge(input: { transactionId: string; purpose: MfaChallengePurpose; factorId: string; subjectId: string; applicationId: string; counter: number; nowMs: number }) {
    const id = userId(input.subjectId);
    if (id === null) return 'invalid-transaction' as const;
    return this.sql.begin(async (tx) => {
      const [challenge] = await tx<Record<string, unknown>[]>`
        select * from idoc.mfa_challenge_transactions where transaction_id=${input.transactionId} for update`;
      if (!challenge || Number(challenge.user_id) !== id || challenge.application_id !== input.applicationId ||
        challenge.purpose !== input.purpose || challenge.consumed_at ||
        (challenge.expires_at as Date).getTime() <= input.nowMs) return 'invalid-transaction' as const;
      if (Number(challenge.attempt_count) >= Number(challenge.max_attempts)) return 'attempts-exhausted' as const;
      const [factor] = await tx<Record<string, unknown>[]>`
        select * from idoc.mfa_factors where factor_id=${input.factorId} for update`;
      if (!factor || Number(factor.user_id) !== id || factor.application_id !== input.applicationId || factor.status !== 'active') {
        return 'inactive' as const;
      }
      if (factor.last_accepted_counter !== null && Number(factor.last_accepted_counter) >= input.counter) return 'replay' as const;
      await tx`update idoc.mfa_factors set last_accepted_counter=${input.counter}, updated_at=${date(input.nowMs)} where factor_id=${input.factorId}`;
      await tx`update idoc.mfa_challenge_transactions set consumed_at=${date(input.nowMs)},
        satisfied_factor_id=${input.factorId}, attempt_count=attempt_count+1 where transaction_id=${input.transactionId}`;
      return 'accepted' as const;
    });
  }

  async replaceRecoveryCodes(input: { subjectId: string; applicationId: string; generationId: string; codes: readonly RecoveryCodeRecord[]; nowMs: number }): Promise<void> {
    const id = userId(input.subjectId);
    if (id === null || input.codes.some((code) => code.subjectId !== input.subjectId || code.applicationId !== input.applicationId || code.generationId !== input.generationId)) {
      throw new Error('Invalid recovery-code binding.');
    }
    await this.sql.begin(async (tx) => {
      const [owner] = await tx`select id from idoc.users where id=${id} for update`;
      if (!owner) throw new Error('Invalid recovery-code owner.');
      await tx`delete from idoc.mfa_recovery_codes where user_id=${id} and application_id=${input.applicationId}`;
      for (const code of input.codes) {
        await tx`insert into idoc.mfa_recovery_codes
          (recovery_code_id,user_id,application_id,generation_id,digest,consumed_at,created_at)
          values (${code.recoveryCodeId},${id},${code.applicationId},${code.generationId},${code.digest},
            ${code.consumedAtMs === null ? null : date(code.consumedAtMs)},${date(code.createdAtMs)})`;
      }
    });
  }

  async consumeRecoveryCode(input: { subjectId: string; applicationId: string; digests: readonly string[]; nowMs: number }) {
    const id = userId(input.subjectId);
    if (id === null || input.digests.length === 0) return 'invalid' as const;
    const rows = await this.sql<Record<string, unknown>[]>`
      update idoc.mfa_recovery_codes set consumed_at=${date(input.nowMs)}
      where recovery_code_id=(select recovery_code_id from idoc.mfa_recovery_codes
        where user_id=${id} and application_id=${input.applicationId} and digest in ${this.sql(input.digests)}
          and consumed_at is null limit 1 for update skip locked)
      returning recovery_code_id`;
    return rows.length === 1 ? 'consumed' as const : 'invalid' as const;
  }

  async createRememberedDevice(record: RememberedDeviceRecord): Promise<void> {
    const id = userId(record.subjectId);
    if (id === null) throw new Error('Invalid remembered-device owner.');
    const rows = await this.sql`insert into idoc.mfa_remembered_devices
      (remembered_device_id,user_id,application_id,factor_id,token_digest,expires_at,revoked_at,created_at)
      select ${record.rememberedDeviceId},${id},${record.applicationId},${record.factorId},${record.tokenDigest},
        ${date(record.expiresAtMs)},${record.revokedAtMs === null ? null : date(record.revokedAtMs)},${date(record.issuedAtMs)}
      from idoc.mfa_factors where factor_id=${record.factorId} and user_id=${id}
        and application_id=${record.applicationId} and status='active' returning remembered_device_id`;
    if (rows.length !== 1) throw new Error('Invalid remembered-device factor binding.');
  }

  async consumeRememberedDevice(input: { subjectId: string; applicationId: string; tokenDigest: string; nowMs: number }) {
    const id = userId(input.subjectId);
    if (id === null) return 'invalid' as const;
    const rows = await this.sql`select d.remembered_device_id from idoc.mfa_remembered_devices d
      join idoc.mfa_factors f on f.factor_id=d.factor_id and f.user_id=d.user_id and f.application_id=d.application_id
      where d.user_id=${id} and d.application_id=${input.applicationId} and d.token_digest=${input.tokenDigest}
        and d.revoked_at is null and d.expires_at>${date(input.nowMs)} and f.status='active' limit 1`;
    return rows.length === 1 ? 'valid' as const : 'invalid' as const;
  }

  async revokeRememberedDevices(subjectId: string, applicationId: string, nowMs: number): Promise<void> {
    const id = userId(subjectId);
    if (id === null) return;
    await this.sql`update idoc.mfa_remembered_devices set revoked_at=${date(nowMs)}, revoke_reason='user_revocation'
      where user_id=${id} and application_id=${applicationId} and revoked_at is null`;
  }

  async createChallenge(input: { transactionId: string; subjectId: string; applicationId: string; purpose: MfaChallengePurpose; expiresAtMs: number; maxAttempts: number; nowMs: number }): Promise<void> {
    const id = userId(input.subjectId);
    if (id === null || !Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.expiresAtMs <= input.nowMs) {
      throw new Error('Invalid MFA challenge.');
    }
    await this.sql`insert into idoc.mfa_challenge_transactions
      (transaction_id,user_id,application_id,purpose,expires_at,max_attempts,created_at)
      values (${input.transactionId},${id},${input.applicationId},${input.purpose},${date(input.expiresAtMs)},
        ${input.maxAttempts},${date(input.nowMs)})`;
  }

  async recordChallengeFailure(input: { transactionId: string; subjectId: string; applicationId: string; purpose: MfaChallengePurpose; nowMs: number }) {
    const id = userId(input.subjectId);
    if (id === null) return 'invalid-transaction' as const;
    const rows = await this.sql<Record<string, unknown>[]>`update idoc.mfa_challenge_transactions
      set attempt_count=attempt_count+1 where transaction_id=${input.transactionId} and user_id=${id}
        and application_id=${input.applicationId} and purpose=${input.purpose} and consumed_at is null
        and expires_at>${date(input.nowMs)} and attempt_count<max_attempts returning attempt_count,max_attempts`;
    if (!rows[0]) return 'invalid-transaction' as const;
    return Number(rows[0].attempt_count) >= Number(rows[0].max_attempts) ? 'attempts-exhausted' as const : 'recorded' as const;
  }

  async revokeFactor(input: { factorId: string; subjectId: string; applicationId: string; reason: string; nowMs: number }): Promise<boolean> {
    const id = userId(input.subjectId);
    if (id === null || !input.reason.trim()) return false;
    return this.sql.begin(async (tx) => {
      const rows = await tx`update idoc.mfa_factors set status='revoked', revoked_at=${date(input.nowMs)},
        lifecycle_reason=${input.reason}, updated_at=${date(input.nowMs)} where factor_id=${input.factorId}
        and user_id=${id} and application_id=${input.applicationId} and status in ('pending','active','disabled') returning factor_id`;
      if (rows.length !== 1) return false;
      await tx`update idoc.mfa_remembered_devices set revoked_at=${date(input.nowMs)}, revoke_reason='factor_revoked'
        where factor_id=${input.factorId} and revoked_at is null`;
      return true;
    });
  }
}

export const mfaStore = new PostgresMfaStore();
