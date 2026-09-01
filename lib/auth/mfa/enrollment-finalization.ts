import 'server-only';

import { client } from '@/lib/db/drizzle';
import type { RecoveryCodeRecord } from './types';

const RECOVERY_ACK_TTL_MS = 10 * 60 * 1000;

function timestamp(ms: number) {
  return new Date(ms).toISOString();
}

export async function finalizeInitialAuthenticatorEnrollment(input: {
  acceptedCounter: number;
  applicationId: string;
  factorId: string;
  nowMs?: number;
  recoveryCodes: readonly RecoveryCodeRecord[];
  recoveryGenerationId: string;
  transactionId: string;
  userId: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(input.userId) || input.userId < 1 || input.recoveryCodes.length === 0 ||
    input.recoveryCodes.some((code) => code.subjectId !== String(input.userId) ||
      code.applicationId !== input.applicationId || code.generationId !== input.recoveryGenerationId)) {
    return { status: 'invalid-transaction' as const };
  }

  return client.begin(async (tx) => {
    const [user] = await tx<Record<string, unknown>[]>`
      select id,email,account_state,email_verified_at,deleted_at from idoc.users
      where id=${input.userId} for update`;
    if (!user || !['active', 'onboarding'].includes(String(user.account_state)) || !user.email_verified_at || user.deleted_at) {
      return { status: 'invalid-transaction' as const };
    }

    const [enrollment] = await tx<Record<string, unknown>[]>`
      select * from idoc.mfa_enrollment_transactions where transaction_id=${input.transactionId} for update`;
    if (!enrollment || Number(enrollment.user_id) !== input.userId || enrollment.application_id !== input.applicationId ||
      enrollment.factor_id !== input.factorId || enrollment.purpose !== 'mfa-enrollment' || enrollment.consumed_at ||
      new Date(String(enrollment.expires_at)).getTime() <= nowMs) return { status: 'invalid-transaction' as const };

    const [factor] = await tx<Record<string, unknown>[]>`
      select * from idoc.mfa_factors where factor_id=${input.factorId} for update`;
    if (!factor || Number(factor.user_id) !== input.userId || factor.application_id !== input.applicationId ||
      factor.status !== 'pending') return { status: 'invalid-transaction' as const };
    if (factor.last_accepted_counter !== null && Number(factor.last_accepted_counter) >= input.acceptedCounter) {
      return { status: 'replay' as const };
    }

    const [activeFactor] = await tx`
      select factor_id from idoc.mfa_factors where user_id=${input.userId} and application_id=${input.applicationId}
        and factor_type='totp' and status='active' for update`;
    if (activeFactor) return { status: 'invalid-transaction' as const };

    await tx`update idoc.mfa_enrollment_transactions
      set consumed_at=${timestamp(nowMs)}, expires_at=${timestamp(nowMs + RECOVERY_ACK_TTL_MS)}
      where transaction_id=${input.transactionId}`;
    await tx`update idoc.mfa_factors set status='active',activated_at=${timestamp(nowMs)},
      last_accepted_counter=${input.acceptedCounter},updated_at=${timestamp(nowMs)} where factor_id=${input.factorId}`;

    await tx`delete from idoc.mfa_recovery_codes where user_id=${input.userId} and application_id=${input.applicationId}`;
    for (const code of input.recoveryCodes) {
      await tx`insert into idoc.mfa_recovery_codes
        (recovery_code_id,user_id,application_id,generation_id,digest,consumed_at,created_at)
        values (${code.recoveryCodeId},${input.userId},${code.applicationId},${code.generationId},${code.digest},
          ${code.consumedAtMs === null ? null : timestamp(code.consumedAtMs)},${timestamp(code.createdAtMs)})`;
    }

    await tx`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,reason)
      values(${input.userId},'auth.mfa.authenticator.enrolled','user',${String(input.userId)},'totp')`;
    await tx`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
      values(${input.userId},'authenticator_enrolled',${String(user.email)},${`authenticator-enrolled:${input.transactionId}`})
      on conflict (dedupe_key) where dedupe_key is not null do nothing`;

    return { status: 'activated' as const };
  });
}
