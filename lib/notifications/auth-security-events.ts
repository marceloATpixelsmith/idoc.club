import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';

export const AUTH_SECURITY_KINDS = [
  'google_identity_linked', 'google_identity_unlinked', 'password_changed',
  'password_reset_completed', 'verified_email_changed', 'authenticator_enrolled',
  'authenticator_replaced', 'recovery_code_used', 'role_granted', 'role_revoked',
  'other_sessions_revoked', 'new_sign_in',
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
    ? await db.execute<{ id: number }>(sql`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
        values (${input.userId},${input.kind},${input.recipientEmail},${input.dedupeKey})
        on conflict (dedupe_key) where dedupe_key is not null do nothing returning id`)
    : await db.execute<{ id: number }>(sql`insert into idoc.auth_security_notification_outbox(user_id,kind,recipient_email,dedupe_key)
        select id,${input.kind},email,${input.dedupeKey} from idoc.users where id=${input.userId}
        on conflict (dedupe_key) where dedupe_key is not null do nothing returning id`);
  return Boolean(rows[0]);
}
