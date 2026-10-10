import 'server-only';

import { createHash } from 'node:crypto';
import { jwtVerify } from 'jose';

export const QSTASH_JOBS = {
  'account-delivery': '0 9 * * *',
  'seminar-cancellation-resolution': '5 9 * * *',
  'clock-skew-check': '10 9 * * *',
  'renewal-notice-scan': '20 7 * * *',
  'renewal-notice-delivery-morning': '30 7 * * *',
  'reconciliation-scan': '0 7 * * *',
  'data-retention-purge': '0 8 * * *',
  'news-scheduled-publish': '15 8 * * *',
  'new-relic-weekly-health-check': '0 8 * * 1',
} as const;

export type QStashJob = keyof typeof QSTASH_JOBS;

export function qstashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN && process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY && process.env.QSTASH_CALLBACK_BASE_URL);
}

export function qstashCallbackUrl(): string {
  const base = process.env.QSTASH_CALLBACK_BASE_URL;
  if (!base) throw new Error('QSTASH_CALLBACK_BASE_URL is required.');
  const url = new URL('/api/qstash/jobs', base);
  if (url.protocol !== 'https:') throw new Error('QStash callbacks require HTTPS.');
  return url.href;
}

/** Only non-sensitive job names cross the QStash API. Database remains the authority. */
export async function publishQStashJob(job: QStashJob, delaySeconds = 0): Promise<boolean> {
  if (!qstashConfigured()) return false;
  const token = process.env.QSTASH_TOKEN!;
  const apiUrl = new URL(process.env.QSTASH_URL ?? 'https://qstash.upstash.io');
  if (apiUrl.protocol !== 'https:') throw new Error('QStash API requires HTTPS.');
  const destination = qstashCallbackUrl();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Upstash-Method': 'POST',
    'Upstash-Retries': '3',
  };
  if (delaySeconds > 0) headers['Upstash-Delay'] = `${Math.ceil(delaySeconds)}s`;
  const response = await fetch(new URL(`/v2/publish/${destination}`, apiUrl), {
    method: 'POST', headers, body: JSON.stringify({ job }), cache: 'no-store',
  });
  if (!response.ok) throw new Error(`QStash publish failed (${response.status})`);
  return true;
}

export async function verifyQStashRequest(request: Request, rawBody: string): Promise<boolean> {
  const signature = request.headers.get('upstash-signature');
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!signature || !current || !next) return false;
  // Schedules append ?job=<name> so the Upstash console can tell them apart; the signed body stays authoritative.
  const destinations = [qstashCallbackUrl()];
  const job = new URL(request.url).searchParams.get('job');
  if (job && /^[a-z-]+$/.test(job)) destinations.push(`${destinations[0]}?job=${job}`);
  const hash = createHash('sha256').update(rawBody).digest('base64url');
  for (const key of [current, next]) {
    try {
      const { payload } = await jwtVerify(signature, new TextEncoder().encode(key), {
        issuer: 'Upstash', algorithms: ['HS256'], requiredClaims: ['sub', 'exp', 'nbf'],
      });
      if (typeof payload.sub === 'string' && destinations.includes(payload.sub) && typeof payload.body === 'string' && payload.body.replace(/=+$/, '') === hash) return true;
    } catch { /* signing-key rotation: try the other configured key */ }
  }
  return false;
}
