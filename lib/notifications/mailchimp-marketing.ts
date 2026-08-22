import 'server-only';

import { createHash } from 'node:crypto';
import { mailchimpAudienceIdForServer, mailchimpMarketingApiKeyForServer } from '@/lib/runtime/configuration';

/** Matches lib/auth/email-otp.ts's deliveryFailureCategory: derives a category from the exception
 * without ever retaining the exception text itself in logged evidence. */
function deliveryFailureCategory(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('not configured') || message.includes('configuration')) return 'configuration';
  if (message.includes('connect') || message.includes('network')) return 'network';
  return 'operational';
}

/** Subscribes an email to the IDOC events/workshops/certifications Mailchimp Marketing audience,
 * per the "Keep me updated" onboarding consent checkbox (docs/02 section 1.3). Never throws: a
 * missing/misconfigured Marketing API key or audience ID, or an unreachable Mailchimp Marketing API,
 * must never block onboarding -- account-standing, payment, security, and renewal messages flow
 * through the separate Mailchimp Transactional API (lib/notifications/mailchimp-transactional.ts)
 * regardless of this opt-in's outcome. */
export async function subscribeToMarketingList(untrustedEmail: string): Promise<void> {
  const email = untrustedEmail.trim().toLowerCase();
  let apiKey: string;
  let audienceId: string;
  try {
    apiKey = mailchimpMarketingApiKeyForServer();
    audienceId = mailchimpAudienceIdForServer();
  } catch {
    console.error('mailchimp_marketing_subscribe_skipped', { category: 'configuration' });
    return;
  }
  const datacenter = apiKey.split('-').at(-1);
  const subscriberHash = createHash('md5').update(email).digest('hex');
  try {
    const response = await fetch(`https://${datacenter}.api.mailchimp.com/3.0/lists/${audienceId}/members/${subscriberHash}`, {
      body: JSON.stringify({ email_address: email, status_if_new: 'subscribed' }),
      headers: {
        authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      method: 'PUT',
    });
    if (!response.ok) throw new Error(`Mailchimp Marketing rejected the subscription (status ${response.status}).`);
  } catch (error) {
    console.error('mailchimp_marketing_subscribe_failed', { category: deliveryFailureCategory(error) });
  }
}
