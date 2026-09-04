import 'server-only';

import { client } from '@/lib/db/drizzle';
import type { TotpEnrollmentRecord, TotpFactorRecord } from './types';

function timestamp(ms: number) {
  return new Date(ms).toISOString();
}

export async function consumeRecoveryCodeAndBeginReplacement(input: {
  applicationId: string;
  dedupeKey: string;
  digests: readonly string[];
  enrollment: TotpEnrollmentRecord;
  factor: TotpFactorRecord;
  nowMs?: number;
  recipientEmail: string;
  userId: number;
}) {
  if (!Number.isSafeInteger(input.userId) || input.userId < 1 || input.digests.length === 0 ||
    input.factor.subjectId !== String(input.userId) || input.factor.applicationId !== input.applicationId ||
    input.factor.factorId !== input.enrollment.factorId || input.factor.status !== 'pending' ||
    input.enrollment.subjectId !== String(input.userId) || input.enrollment.applicationId !== input.applicationId ||
    input.enrollment.purpose !== 'authenticator-replacement') return 'invalid' as const;
  const nowMs = input.nowMs ?? Date.now();
  return client.begin(async (tx) => {
    const rows = await tx<{ recovery_code_id: string }[]>`
      update idoc.mfa_recovery_codes set consumed_at=${timestamp(nowMs)}
      where recovery_code_id=(select recovery_code_id from idoc.mfa_recovery_codes
        where user_id=${input.userId} and application_id=${input.applicationId}
          and digest in ${tx(input.digests)} and consumed_at is null
        limit 1 for update skip locked)
      returning recovery_code_id`;
    if (rows.length !== 1) return 'invalid' as const;
    await tx`insert into idoc.mfa_factors
      (factor_id,user_id,application_id,status,encrypted_secret,encryption_key_id,last_accepted_counter,
       activated_at,replaced_by_factor_id,created_at,updated_at)
      values (${input.factor.factorId},${input.userId},${input.factor.applicationId},${input.factor.status},
        ${input.factor.encryptedSecret},${input.factor.keyId},${input.factor.lastAcceptedCounter},
        ${input.factor.activatedAtMs === null ? null : timestamp(input.factor.activatedAtMs)},
        ${input.factor.replacedByFactorId},${timestamp(input.factor.createdAtMs)},${timestamp(input.factor.createdAtMs)})`;
    await tx`insert into idoc.mfa_enrollment_transactions
      (transaction_id,user_id,application_id,factor_id,purpose,expires_at,consumed_at,created_at)
      values (${input.enrollment.transactionId},${input.userId},${input.enrollment.applicationId},
        ${input.enrollment.factorId},${input.enrollment.purpose},${timestamp(input.enrollment.expiresAtMs)},
        ${input.enrollment.consumedAtMs === null ? null : timestamp(input.enrollment.consumedAtMs)},
        ${timestamp(input.enrollment.createdAtMs)})`;
    await tx`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,reason)
      values(${input.userId},'auth.mfa.recovery_code.used','user',${String(input.userId)},'authenticator-replacement')`;
    await tx`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
      values(${input.userId},'recovery_code_used',${input.recipientEmail},${input.dedupeKey})
      on conflict (dedupe_key) where dedupe_key is not null do nothing`;
    return 'consumed' as const;
  });
}
