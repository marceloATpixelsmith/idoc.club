import 'server-only';

import { randomUUID } from 'node:crypto';
import { client } from '@/lib/db/drizzle';
import { sendTransactionalEmail } from './mailchimp-transactional';
import { renderTransactionalEmail } from './email-template';

const MAX_ATTEMPTS = 6;

export async function deliverNextAuthSecurityNotification(owner: string = randomUUID()) {
  const rows = await client<{
    id: number;
    user_id: number;
    kind: 'google_identity_linked' | 'google_identity_unlinked';
    attempt_count: number;
    email: string;
  }[]>`
    with candidate as (
      select o.id
      from idoc.auth_security_notification_outbox o
      where o.sent_at is null and o.dead_lettered_at is null and o.available_at <= now()
        and (o.lease_expires_at is null or o.lease_expires_at < now())
      order by o.available_at, o.id
      for update skip locked
      limit 1
    )
    update idoc.auth_security_notification_outbox o
    set lease_owner=${owner}, lease_expires_at=now()+interval '5 minutes'
    from candidate, idoc.users u
    where o.id=candidate.id and u.id=o.user_id
    returning o.id, o.user_id, o.kind, o.attempt_count, u.email
  `;
  const record = rows[0];
  if (!record) return { status: 'empty' as const };

  try {
    const linked = record.kind === 'google_identity_linked';
    const html = renderTransactionalEmail({
      heading: linked ? 'Google account connected' : 'Google account disconnected',
      bodyHtml: linked
        ? '<p>A Google account was connected to your IDOC account. If you did not make this change, contact IDOC immediately.</p>'
        : '<p>The Google account connected to your IDOC account was removed. If you did not make this change, contact IDOC immediately.</p>',
      footerNote: 'This is a security notification for your IDOC account.',
    });
    await sendTransactionalEmail({
      html,
      messageId: `auth-security-${record.id}`,
      subject: linked ? 'Google account connected to IDOC' : 'Google account disconnected from IDOC',
      to: record.email,
    });
    const done = await client`
      update idoc.auth_security_notification_outbox
      set sent_at=now(), attempt_count=attempt_count+1, last_attempt_at=now(), last_error_code=null,
          lease_owner=null, lease_expires_at=null
      where id=${record.id} and lease_owner=${owner} and sent_at is null
      returning id
    `;
    return { status: done[0] ? 'delivered' as const : 'lease_lost' as const };
  } catch {
    const attempt = record.attempt_count + 1;
    const delay = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
    await client`
      update idoc.auth_security_notification_outbox
      set attempt_count=${attempt}, last_attempt_at=now(), last_error_code='temporary_delivery_failure',
          available_at=now()+(${delay} * interval '1 second'),
          dead_lettered_at=case when ${attempt} >= ${MAX_ATTEMPTS} then now() else null end,
          lease_owner=null, lease_expires_at=null
      where id=${record.id} and lease_owner=${owner}
    `;
    return { status: attempt >= MAX_ATTEMPTS ? 'dead_lettered' as const : 'retryable' as const };
  }
}

export async function processAuthSecurityNotificationBatch(limit = 25) {
  const results: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await deliverNextAuthSecurityNotification();
    results.push(result.status);
    if (result.status === 'empty') break;
  }
  return results;
}
