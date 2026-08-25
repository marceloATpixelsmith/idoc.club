import 'server-only';

import { createHash } from 'node:crypto';
import { mailchimpAudienceIdForServer, mailchimpMarketingApiKeyForServer } from '@/lib/runtime/configuration';

function deliveryFailureCategory(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('not configured') || message.includes('configuration')) return 'configuration';
  if (message.includes('connect') || message.includes('network')) return 'network';
  if (message.includes('timeout') || message.includes('Abort')) return 'timeout';
  return 'operational';
}

/**
 * Best-effort Mailchimp Marketing subscription for the optional onboarding opt-in.
 * This is deliberately isolated from mandatory transactional/account mail and never throws.
 */
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
      body: JSON.stringify({ email_address: email, status: 'subscribed' }),
      headers: {
        authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      method: 'PUT',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Mailchimp Marketing rejected the subscription (status ${response.status}).`);
  } catch (error) {
    console.error('mailchimp_marketing_subscribe_failed', { category: deliveryFailureCategory(error) });
  }
}
