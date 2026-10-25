import 'server-only';

import { client } from '@/lib/db/drizzle';
import type { EmailLinkReference } from './email-links';

/** Who a verified email link was sent to, and which kind of notice it was in. Null when the stored message is gone. */
export async function emailLinkRecipient(reference: EmailLinkReference): Promise<{ kind: string; userId: number } | null> {
  const rows = reference.source === 'notification'
    ? await client<{ kind: string; user_id: number }[]>`select o.kind, p.user_id from notification_outbox o join profiles p on p.id = o.profile_id where o.id = ${reference.id} limit 1`
    : await client<{ kind: string; user_id: number }[]>`select kind, user_id from auth_security_notification_outbox where id = ${reference.id} and user_id is not null limit 1`;
  return rows[0] ? { kind: rows[0].kind, userId: rows[0].user_id } : null;
}
