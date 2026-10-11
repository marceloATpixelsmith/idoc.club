// Register stable QStash schedules only after setting the credentials of the EU QStash resource (eu-central-1), which staging and production both use. Never the US resource.
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
  'renewal-notice-scan': '20 7 * * *',
  'renewal-notice-delivery-morning': '30 7 * * *',
  'reconciliation-scan': '0 7 * * *',
  'data-retention-purge': '0 8 * * *',
  'news-scheduled-publish': '15 8 * * *',
  'new-relic-weekly-health-check': '0 8 * * 1',
  'postgres-metrics-export': '0 * * * *',
};
// This job's route only runs on the staging branch; registering it for the production host would produce hourly 404s and retries.
const stagingOnly = new Set(['postgres-metrics-export']);
const isStagingHost = new URL(origin).hostname === 'staging.idoc.club';
for (const [job, cron] of Object.entries(jobs)) {
  if (stagingOnly.has(job) && !isStagingHost) { console.log(`${job}: skipped (staging host only)`); continue; }
  // The ?job= query makes each schedule's destination distinct in the Upstash console; the signed body stays authoritative.
  // The destination is a path parameter of the API call, so its own query string must be percent-encoded.
  const destination = new URL(url);
  destination.searchParams.set('job', job);
  const response = await fetch(new URL(`/v2/schedules/${destination.href.replace('?', '%3F')}`, api), {
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
