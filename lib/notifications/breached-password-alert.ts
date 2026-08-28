import 'server-only';

import { escapeHtml, renderTransactionalEmail } from './email-template';
import { sendTransactionalEmail } from './mailchimp-transactional';

export type BreachedPasswordSource = 'migration-activation' | 'password-change' | 'password-reset' | 'password-reset-token' | 'signup';

const SOURCE_LABEL: Record<BreachedPasswordSource, string> = {
  'migration-activation': 'migrated-account activation',
  'password-change': 'a self-service password change',
  'password-reset': 'a password reset',
  'password-reset-token': 'a legacy password-reset/activation link',
  signup: 'account signup',
};

/** Best-effort operational alert only: never blocks the caller's own rejection of the breached
 * password (that rejection is the actual security control), and never includes the password, its
 * hash, or any breach-provider hash. Routed to the existing operations recipient documented in
 * docs/07 §15 (`IDOC_ADMIN_NOTIFICATION_EMAIL`) rather than a new dedicated env var, since that
 * variable is already exactly "operations recipient for privileged production configuration
 * alerts/workflows." Skips (rather than throws) when unconfigured, matching the established
 * precedent in lib/notifications/profile-change-delivery.ts. */
export async function notifyWebmasterOfBreachedPasswordAttempt(input: { email?: string; source: BreachedPasswordSource }): Promise<void> {
  const to = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    console.warn('breached_password_alert_skipped', { category: 'configuration' });
    return;
  }
  try {
    const who = input.email ? ` for <b>${escapeHtml(input.email)}</b>` : '';
    const html = renderTransactionalEmail({
      bodyHtml: `<p>A password submitted during ${SOURCE_LABEL[input.source]}${who} matched a known public data breach and was rejected before it was ever stored. No action is required unless this account also shows other suspicious activity.</p>`,
      footerNote: 'IDOC security monitoring. This message never contains the password itself.',
      heading: 'Breached password rejected',
    });
    await sendTransactionalEmail({ html, subject: 'IDOC: breached password rejected', to });
  } catch {
    console.warn('breached_password_alert_failed', { category: 'delivery' });
  }
}
