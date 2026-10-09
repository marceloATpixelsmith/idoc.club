import 'server-only';
import { communicationHoldTimestamp, memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { dispatchQueuedEmailAfterResponse } from './immediate-dispatch';
import { processAuthSecurityNotificationBatch } from './auth-security-delivery';

export const AUTH_SECURITY_KINDS = [
  'google_identity_linked', 'google_identity_unlinked', 'password_changed',
  'password_reset_completed', 'verified_email_changed', 'authenticator_enrolled',
  'authenticator_replaced', 'recovery_code_used', 'recovery_codes_regenerated', 'role_granted', 'role_revoked',
  'other_sessions_revoked', 'new_sign_in', 'passkey_registered', 'passkey_removed',
  'account_suspended', 'account_reinstated', 'mfa_replay_detected', 'authority_force_revoked',
] as const;

export type AuthSecurityKind = (typeof AUTH_SECURITY_KINDS)[number];

/** Persists only delivery routing and a stable event identity; never credentials or secret material. */
export async function enqueueAuthSecurityNotification(input: {
  dedupeKey: string;
  kind: AuthSecurityKind;
  recipientEmail?: string;
  userId: number;
}) {
  const rows = input.recipientEmail
    ? await db.execute<{ id: number }>(sql`insert into auth_security_notification_outbox(dead_lettered_at,last_error_code,user_id,kind,recipient_email,dedupe_key)
        values (${communicationHoldTimestamp()}::timestamptz,case when ${memberCommunicationsDisabled()} then 'member_launch_hold' else null end,${input.userId},${input.kind},${input.recipientEmail},${input.dedupeKey})
        on conflict (dedupe_key) where dedupe_key is not null do nothing returning id`)
    : await db.execute<{ id: number }>(sql`insert into auth_security_notification_outbox(dead_lettered_at,last_error_code,user_id,kind,recipient_email,dedupe_key)
        select ${communicationHoldTimestamp()}::timestamptz,case when ${memberCommunicationsDisabled()} then 'member_launch_hold' else null end,id,${input.kind},email,${input.dedupeKey} from users where id=${input.userId}
        on conflict (dedupe_key) where dedupe_key is not null do nothing returning id`);
  if (rows[0]) dispatchQueuedEmailAfterResponse(() => processAuthSecurityNotificationBatch(1), 'account-delivery');
  return Boolean(rows[0]);
}
