import 'server-only';

import { createHash } from 'node:crypto';

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Best-effort onboarding subscription. Provider/configuration failures must not
 * roll back or otherwise affect the already-committed member profile.
 */
export async function subscribeToMarketingAudience(email: string): Promise<void> {
  const apiKey = process.env.MAILCHIMP_MARKETING_API_KEY?.trim();
  const audienceId = process.env.MAILCHIMP_MARKETING_AUDIENCE_ID?.trim();
  const serverPrefix = process.env.MAILCHIMP_MARKETING_SERVER_PREFIX?.trim();
  if (!(apiKey && audienceId && serverPrefix)) return;

  const normalizedEmail = email.trim().toLowerCase();
  const memberHash = createHash('md5').update(normalizedEmail).digest('hex');
  try {
    await fetch(`https://${serverPrefix}.api.mailchimp.com/3.0/lists/${audienceId}/members/${memberHash}`, {
      body: JSON.stringify({
        email_address: normalizedEmail,
        status: 'subscribed',
        status_if_new: 'subscribed',
      }),
      headers: {
        Authorization: `Basic ${Buffer.from(`idoc:${apiKey}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      method: 'PUT',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Marketing delivery is deliberately isolated from onboarding and billing.
  }
}
