import 'server-only';

import { client } from '@/lib/db/drizzle';
import type { RecoveryCodeRecord } from './types';

function timestamp(ms: number): string {
  return new Date(ms).toISOString();
}

/** Atomically replaces a user's recovery authority without changing their authenticator. */
export async function regenerateRecoveryCodesWithEvidence(input: {
  applicationId: string;
  expectedSessionVersion: number;
  generationId: string;
  nowMs?: number;
  records: readonly RecoveryCodeRecord[];
  userId: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(input.userId) || input.userId < 1 || input.records.length === 0 ||
    input.records.some((record) => record.subjectId !== String(input.userId) ||
      record.applicationId !== input.applicationId || record.generationId !== input.generationId)) {
    return 'invalid' as const;
  }

  return client.begin(async (tx) => {
    const [user] = await tx<{ email: string; session_version: number }[]>`
      select email,session_version from idoc.users where id=${input.userId} and deleted_at is null
        and account_state in ('active','onboarding') for update`;
    if (!user || user.session_version !== input.expectedSessionVersion) return 'invalid' as const;
    const [factor] = await tx`
      select factor_id from idoc.mfa_factors where user_id=${input.userId}
        and application_id=${input.applicationId} and factor_type='totp' and status='active' for update`;
    if (!factor) return 'invalid' as const;

    await tx`delete from idoc.mfa_recovery_codes
      where user_id=${input.userId} and application_id=${input.applicationId}`;
    for (const record of input.records) {
      await tx`insert into idoc.mfa_recovery_codes
        (recovery_code_id,user_id,application_id,generation_id,digest,consumed_at,created_at)
        values (${record.recoveryCodeId},${input.userId},${record.applicationId},${record.generationId},
          ${record.digest},${record.consumedAtMs === null ? null : timestamp(record.consumedAtMs)},
          ${timestamp(record.createdAtMs)})`;
    }
    await tx`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,reason)
      values(${input.userId},'auth.mfa.recovery_codes.regenerated','user',${String(input.userId)},'account-security')`;
    await tx`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
      values(${input.userId},'recovery_codes_regenerated',${user.email},${`recovery-codes:${input.generationId}`})`;
    return 'regenerated' as const;
  });
}
