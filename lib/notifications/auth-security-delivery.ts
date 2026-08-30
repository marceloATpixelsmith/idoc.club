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
    kind: string;
    attempt_count: number;
    recipient_email: string;
    created_at: Date;
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
    from candidate
    where o.id=candidate.id
    returning o.id, o.user_id, o.kind, o.attempt_count, o.recipient_email, o.created_at
  `;
  const record = rows[0];
  if (!record) return { status: 'empty' as const };

  try {
    const content: Record<string, { heading: string; subject: string }> = {
      authenticator_enrolled: { heading: 'Authenticator enabled', subject: 'Authenticator enabled for IDOC' },
      authenticator_replaced: { heading: 'Authenticator replaced', subject: 'Authenticator replaced for IDOC' },
      google_identity_linked: { heading: 'Google account connected', subject: 'Google account connected to IDOC' },
      google_identity_unlinked: { heading: 'Google account disconnected', subject: 'Google account disconnected from IDOC' },
      new_sign_in: { heading: 'New sign-in to your account', subject: 'New sign-in to your IDOC account' },
      other_sessions_revoked: { heading: 'Other sessions logged out', subject: 'IDOC sessions were logged out' },
      password_changed: { heading: 'Password changed', subject: 'Your IDOC password was changed' },
      password_reset_completed: { heading: 'Password reset completed', subject: 'Your IDOC password was reset' },
      recovery_code_used: { heading: 'Recovery code used', subject: 'An IDOC recovery code was used' },
      role_granted: { heading: 'Administrator access granted', subject: 'Your IDOC access changed' },
      role_revoked: { heading: 'Administrator access removed', subject: 'Your IDOC access changed' },
      verified_email_changed: { heading: 'Login email changed', subject: 'Your IDOC login email changed' },
    };
    const message = content[record.kind];
    if (!message) throw new Error('Unsupported security notification kind.');
    const html = renderTransactionalEmail({
      heading: message.heading,
      bodyHtml: `<p>${message.heading} on ${record.created_at.toISOString()}. If you did not make or authorize this change, contact IDOC immediately.</p>`,
      footerNote: 'This is a security notification for your IDOC account.',
    });
    await sendTransactionalEmail({
      html,
      messageId: `auth-security-${record.id}`,
      subject: message.subject,
      to: record.recipient_email,
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
    // `deadLettered` is decided in JS, not repeated in SQL: postgres.js's parameter serialization
    // throws when the identical JS value is interpolated twice in one tagged-template query (the
    // same bug confirmed in production for purgeExpiredGoogleOauthTransactions -- this query had
    // the same shape with `${attempt}` used twice).
    const deadLettered = attempt >= MAX_ATTEMPTS;
    await client`
      update idoc.auth_security_notification_outbox
      set attempt_count=${attempt}, last_attempt_at=now(), last_error_code='temporary_delivery_failure',
          available_at=now()+(${delay} * interval '1 second'),
          dead_lettered_at=${deadLettered ? new Date() : null},
          lease_owner=null, lease_expires_at=null
      where id=${record.id} and lease_owner=${owner}
    `;
    return { status: deadLettered ? 'dead_lettered' as const : 'retryable' as const };
  }
}

export async function processAuthSecurityNotificationBatch(limit = 25) {
  const summary = { deadLettered: 0, delivered: 0, leaseLost: 0, retryable: 0 };
  for (let index = 0; index < limit; index += 1) {
    const result = await deliverNextAuthSecurityNotification();
    if (result.status === 'empty') break;
    if (result.status === 'dead_lettered') summary.deadLettered += 1;
    else if (result.status === 'delivered') summary.delivered += 1;
    else if (result.status === 'lease_lost') summary.leaseLost += 1;
    else summary.retryable += 1;
  }
  return summary;
}
