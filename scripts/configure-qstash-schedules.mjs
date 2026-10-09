// Register stable QStash schedules only after setting the staging resource credentials.
// Run: node scripts/configure-qstash-schedules.mjs
// Requires: QSTASH_TOKEN, QSTASH_CALLBACK_BASE_URL; optional QSTASH_URL.
const token = process.env.QSTASH_TOKEN;
const origin = process.env.QSTASH_CALLBACK_BASE_URL;
const api = process.env.QSTASH_URL || 'https://qstash.upstash.io';
if (!token || !origin) throw new Error('Set QSTASH_TOKEN and QSTASH_CALLBACK_BASE_URL first.');
const url = new URL('/api/qstash/jobs', origin);
if (url.protocol !== 'https:' || new URL(api).protocol !== 'https:') throw new Error('Require HTTPS.');
const jobs = {
  'account-delivery': '0 9 * * *',
  'seminar-cancellation-resolution': '5 9 * * *',
  'clock-skew-check': '10 9 * * *',
  'renewal-notice-scan': '0 6 * * *',
  'renewal-notice-delivery-morning': '15 6 * * *',
  'renewal-notice-delivery-afternoon': '15 14 * * *',
  'renewal-notice-delivery-evening': '15 22 * * *',
  'reconciliation-scan': '0 7 * * *',
  'data-retention-purge': '0 8 * * *',
  'news-scheduled-publish': '0 0 * * *',
};
for (const [job, cron] of Object.entries(jobs)) {
  const response = await fetch(new URL(`/v2/schedules/${url.href}`, api), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Upstash-Cron': cron,
      'Upstash-Schedule-Id': `idoc-${new URL(origin).hostname}-${job}`,
      'Upstash-Method': 'POST',
      'Upstash-Retries': '3',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ job }),
  });
  if (!response.ok) throw new Error(`Failed to register ${job} (${response.status})`);
  console.log(`${job}: ${cron} (UTC)`);
}
