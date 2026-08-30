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
    // A string, not a Date object: this driver returns raw timestamptz columns as ISO strings on
    // raw `client` queries (the same bug confirmed in production for
    // googleOidcTransactionStore.consume -- a TypeError calling a Date method on what TypeScript
    // had declared as Date). drizzle's schema-aware query builder parses these into Date objects
    // itself; a raw `client` query gets the column back exactly as the driver sends it over the
    // wire.
    created_at: string;
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
      bodyHtml: `<p>${message.heading} on ${new Date(record.created_at).toISOString()}. If you did not make or authorize this change, contact IDOC immediately.</p>`,
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
    const deadLettered = attempt >= MAX_ATTEMPTS;
    // `dead_lettered_at` is a string, not a raw Date: this driver's parameter serializer throws
    // trying to serialize a native JS Date passed through the raw `client` tagged template
    // (confirmed in production for purgeExpiredGoogleOauthTransactions -- a TypeError inside
    // Buffer.byteLength). drizzle's query builder never hits this because it stringifies Date
    // values itself before they reach the driver; raw `client` calls have to do the same
    // conversion explicitly.
    await client`
      update idoc.auth_security_notification_outbox
      set attempt_count=${attempt}, last_attempt_at=now(), last_error_code='temporary_delivery_failure',
          available_at=now()+(${delay} * interval '1 second'),
          dead_lettered_at=${deadLettered ? new Date().toISOString() : null},
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
