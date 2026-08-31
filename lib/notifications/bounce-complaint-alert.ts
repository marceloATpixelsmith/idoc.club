import 'server-only';

import { escapeHtml, renderTransactionalEmail } from './email-template';
import { sendTransactionalEmail } from './mailchimp-transactional';
import { taggedSubject } from './alert-severity';
import { logWarn } from '@/lib/observability/logger';

const ALERT_DELIVERY_TIMEOUT_MS = 5_000;

/** Best-effort operational alert only, mirroring google-oauth-failure-alert.ts's pattern: bounded to
 * ALERT_DELIVERY_TIMEOUT_MS so a slow/unresponsive Mailchimp can never hold the webhook response
 * open, and skips (rather than throws) when IDOC_ADMIN_NOTIFICATION_EMAIL is unconfigured. Never
 * includes the bounced/complaining address's raw provider diagnostic text (`msg.diag`) -- only the
 * event type and, for a bounce, Mandrill's own fixed short `bounce_description` code. Deliberately
 * does not suppress or otherwise act on future sends to this address: that is a policy decision this
 * pull request leaves to a human reviewing the alert, not something to decide unilaterally here (see
 * docs/22 AUTH-EMAIL-007 for the reasoning). */
export async function notifyWebmasterOfEmailEvent(input: { email: string; kind: 'email.hard_bounce' | 'email.spam_complaint'; reasonCode?: string }): Promise<void> {
  const to = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    await logWarn('bounce_complaint_alert_skipped', { category: 'configuration' });
    return;
  }
  const label = input.kind === 'email.hard_bounce' ? 'hard bounce' : 'spam complaint';
  const reason = input.reasonCode ? ` (${escapeHtml(input.reasonCode)})` : '';
  const html = renderTransactionalEmail({
    bodyHtml: `<p>A ${label}${reason} was recorded for <b>${escapeHtml(input.email)}</b>. No action has been taken automatically -- review whether this account's future email should be suppressed.</p>`,
    footerNote: 'IDOC delivery monitoring.',
    heading: `Email ${label}`,
  });
  try {
    await sendTransactionalEmail(
      { html, subject: taggedSubject(input.kind, `IDOC: email ${label}`), to },
      { signal: AbortSignal.timeout(ALERT_DELIVERY_TIMEOUT_MS) },
    );
  } catch {
    await logWarn('bounce_complaint_alert_failed', { category: 'delivery' });
  }
}
