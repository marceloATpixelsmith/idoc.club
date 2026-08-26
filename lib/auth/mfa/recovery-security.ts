import 'server-only';

import { client } from '@/lib/db/drizzle';

function timestamp(ms: number) {
  return new Date(ms).toISOString();
}

export async function consumeRecoveryCodeWithEvidence(input: {
  applicationId: string;
  dedupeKey: string;
  digests: readonly string[];
  nowMs?: number;
  recipientEmail: string;
  userId: number;
}) {
  if (!Number.isSafeInteger(input.userId) || input.userId < 1 || input.digests.length === 0) return 'invalid' as const;
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
    await tx`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,reason)
      values(${input.userId},'auth.mfa.recovery_code.used','user',${String(input.userId)},'authenticator-replacement')`;
    await tx`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
      values(${input.userId},'recovery_code_used',${input.recipientEmail},${input.dedupeKey})
      on conflict (dedupe_key) where dedupe_key is not null do nothing`;
    return 'consumed' as const;
  });
}
