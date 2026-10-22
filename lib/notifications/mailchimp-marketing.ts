import 'server-only';
import { logMemberLaunchHold, memberCommunicationsDisabled } from '../runtime/member-launch-hold.ts';

import { createHash } from 'node:crypto';

const REQUEST_TIMEOUT_MS = 5000;
const LIST_PAGE_SIZE = 500;
const LIST_MAX_PAGES = 200;
// Mailchimp answers a PUT/PATCH to a member who unsubscribed themselves (or bounced) with this
// title (HTTP 400); only a confirmation email the member clicks can bring them back (docs/19).
const COMPLIANCE_STATE_TITLE = 'Member In Compliance State';

export type MarketingMemberStatus = 'archived' | 'cleaned' | 'not_found' | 'pending' | 'subscribed' | 'transactional' | 'unsubscribed';
export type MarketingOptInOutcome = 'blocked' | 'cleaned' | 'failed' | 'pending' | 'subscribed' | 'unavailable';
export type MarketingOptOutOutcome = 'blocked' | 'failed' | 'not_found' | 'unavailable' | 'unsubscribed';

type MarketingConfig = { apiKey: string; audienceId: string; serverPrefix: string };

function marketingConfig(): MarketingConfig | null {
  const apiKey = process.env.MAILCHIMP_MARKETING_API_KEY?.trim();
  const audienceId = process.env.MAILCHIMP_MARKETING_AUDIENCE_ID?.trim();
  const serverPrefix = process.env.MAILCHIMP_MARKETING_SERVER_PREFIX?.trim();
  return apiKey && audienceId && serverPrefix ? { apiKey, audienceId, serverPrefix } : null;
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function audienceUrl(config: MarketingConfig): string {
  return `https://${config.serverPrefix}.api.mailchimp.com/3.0/lists/${config.audienceId}`;
}

function memberUrl(config: MarketingConfig, normalizedEmail: string): string {
  return `${audienceUrl(config)}/members/${createHash('md5').update(normalizedEmail).digest('hex')}`;
}

function request(config: MarketingConfig, url: string, method: 'GET' | 'PATCH' | 'PUT', body?: Record<string, unknown>) {
  return fetch(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Basic ${Buffer.from(`idoc:${config.apiKey}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    method,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function readMemberStatus(config: MarketingConfig, normalizedEmail: string): Promise<MarketingMemberStatus | 'failed'> {
  try {
    const response = await request(config, `${memberUrl(config, normalizedEmail)}?fields=status`, 'GET');
    if (response.status === 404) return 'not_found';
    if (!response.ok) return 'failed';
    const payload = await response.json() as { status?: unknown };
    switch (payload.status) {
      case 'archived': case 'cleaned': case 'pending': case 'subscribed': case 'transactional': case 'unsubscribed':
        return payload.status;
      default:
        return 'failed';
    }
  } catch {
    return 'failed';
  }
}

async function isComplianceRejection(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  try {
    const payload = await response.json() as { title?: unknown };
    return payload.title === COMPLIANCE_STATE_TITLE;
  } catch {
    return false;
  }
}

/**
 * Asks Mailchimp to (re)subscribe a member who has just consented, and reports what actually
 * happened. Mailchimp refuses `subscribed` for anyone who unsubscribed themselves, so those members
 * are sent a confirmation email via `pending` and only become subscribed once they click it --
 * callers must not treat 'pending' as an active subscription. Never throws; provider problems are
 * reported as 'failed'/'unavailable' so a caller can keep the member-facing action isolated.
 */
export async function requestMarketingOptIn(email: string): Promise<MarketingOptInOutcome> {
  if (memberCommunicationsDisabled()) {
    logMemberLaunchHold('email.marketing_audience');
    return 'blocked';
  }
  const config = marketingConfig();
  if (!config) return 'unavailable';
  const normalizedEmail = normalize(email);
  const status = await readMemberStatus(config, normalizedEmail);
  if (status === 'failed') return 'failed';
  if (status === 'subscribed' || status === 'pending' || status === 'cleaned') return status;
  const url = memberUrl(config, normalizedEmail);
  try {
    if (status === 'unsubscribed') {
      const response = await request(config, url, 'PUT', { email_address: normalizedEmail, status: 'pending' });
      return response.ok ? 'pending' : 'failed';
    }
    const response = await request(config, url, 'PUT', { email_address: normalizedEmail, status: 'subscribed', status_if_new: 'subscribed' });
    if (response.ok) return 'subscribed';
    if (await isComplianceRejection(response)) {
      const retry = await request(config, url, 'PUT', { email_address: normalizedEmail, status: 'pending' });
      return retry.ok ? 'pending' : 'failed';
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Best-effort removal from the marketing audience. Sets only `status` (never `status_if_new`), so
 * a member with no Mailchimp history stays absent rather than gaining a stray unsubscribed row.
 */
export async function requestMarketingOptOut(email: string): Promise<MarketingOptOutOutcome> {
  if (memberCommunicationsDisabled()) {
    logMemberLaunchHold('email.marketing_audience');
    return 'blocked';
  }
  const config = marketingConfig();
  if (!config) return 'unavailable';
  try {
    const response = await request(config, memberUrl(config, normalize(email)), 'PATCH', { status: 'unsubscribed' });
    if (response.status === 404) return 'not_found';
    return response.ok ? 'unsubscribed' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Cancellation-time removal; isolated from the cancellation it accompanies (docs/19). */
export async function unsubscribeFromMarketingAudience(email: string): Promise<void | { status: 'blocked' }> {
  const outcome = await requestMarketingOptOut(email);
  if (outcome === 'blocked') return { status: 'blocked' };
}

export type MarketingAudienceMember = { email: string; status: MarketingMemberStatus };

/**
 * Pages through every audience member currently in the given Mailchimp status, for the daily
 * reconciliation. This only reads from Mailchimp, so (unlike the calls above) it is not an
 * outbound member communication and is not held by the launch hold. Throws when Mailchimp is
 * unconfigured or answers with an error so the caller can report the run as failed rather than as
 * "nobody unsubscribed".
 */
export async function listMarketingMembersByStatus(status: 'cleaned' | 'subscribed' | 'unsubscribed'): Promise<MarketingAudienceMember[]> {
  const config = marketingConfig();
  if (!config) throw new Error('Mailchimp marketing is not configured.');
  const members: MarketingAudienceMember[] = [];
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      count: String(LIST_PAGE_SIZE),
      fields: 'members.email_address,members.status,total_items',
      offset: String(page * LIST_PAGE_SIZE),
      status,
    });
    const response = await request(config, `${audienceUrl(config)}/members?${params.toString()}`, 'GET');
    if (!response.ok) throw new Error(`Mailchimp member listing failed with HTTP ${response.status}.`);
    const payload = await response.json() as { members?: { email_address?: unknown; status?: unknown }[] };
    const batch = payload.members ?? [];
    for (const member of batch) {
      if (typeof member.email_address === 'string') members.push({ email: normalize(member.email_address), status });
    }
    if (batch.length < LIST_PAGE_SIZE) return members;
  }
  throw new Error('Mailchimp member listing exceeded the page limit.');
}
