import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runSucceeded, validJobName, vercelCronJobFromUrl } from '../lib/observability/job-run-record-core.ts';

test('only fixed, well-formed job names are accepted', () => {
  for (const ok of ['account-delivery', 'clock-skew-check', 'a', 'renewal-notice-delivery-morning']) assert.equal(validJobName(ok), true, ok);
  for (const bad of ['', 'Account', '-lead', '1job', 'has space', 'semi;colon', 'a'.repeat(61), 'x/../y', null, undefined, 42]) assert.equal(validJobName(bad), false, String(bad));
});

test('a direct Vercel Cron path yields its job and nothing else does', () => {
  assert.equal(vercelCronJobFromUrl('https://idoc.club/api/cron/account-delivery'), 'account-delivery');
  assert.equal(vercelCronJobFromUrl('https://idoc.club/api/cron/news-scheduled-publish/'), 'news-scheduled-publish');
  assert.equal(vercelCronJobFromUrl('https://idoc.club/api/cron/account-delivery?x=1'), 'account-delivery');
  assert.equal(vercelCronJobFromUrl('https://idoc.club/api/qstash/jobs?job=account-delivery'), null);
  assert.equal(vercelCronJobFromUrl('https://idoc.club/api/cron/'), null);
  assert.equal(vercelCronJobFromUrl('https://idoc.club/api/cron/Bad_Name'), null);
  assert.equal(vercelCronJobFromUrl('https://idoc.club/api/cron/a/b'), null);
  assert.equal(vercelCronJobFromUrl('not a url'), null);
});

test('only 2xx responses count as a successful run', () => {
  for (const status of [200, 201, 204, 299]) assert.equal(runSucceeded(status), true, String(status));
  for (const status of [0, 199, 300, 401, 500, 503, Number.NaN]) assert.equal(runSucceeded(status), false, String(status));
});

test('recording is best-effort, bounded, and wired to both timer systems', () => {
  const recorder = readFileSync('lib/observability/job-run-record.ts', 'utf8');
  const worker = readFileSync('lib/notifications/account-delivery-worker-core.ts', 'utf8');
  const qstash = readFileSync('app/api/qstash/jobs/route.ts', 'utf8');
  assert.match(recorder, /catch \{\s*\/\/ Best-effort only\./);
  assert.match(recorder, /RECORD_TIMEOUT_MS = 2000/);
  assert.match(recorder, /clearTimeout\(timer\)/);
  // The shared worker core must keep database code out of its static imports so database-free callers and unit tests never load it.
  assert.doesNotMatch(worker, /^import .*job-run-record/m);
  assert.match(worker, /await import\('@\/lib\/observability\/job-run-record'\)/);
  // Unauthorized calls are never recorded; authorized success and failure are.
  assert.match(worker, /return Response\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\);\s*try \{/);
  assert.match(worker, /await recordCronRun\(request, 200\)/);
  assert.match(worker, /await recordCronRun\(request, 500\)/);
  // The QStash route records the status it finally returns, including the 503 it converts a failed-resolution summary into and a thrown error.
  assert.match(qstash, /let finalStatus = response\.status;\s*try \{/);
  assert.match(qstash, /\{ finalStatus = 503; return Response\.json\(\{ error: 'Cancellation resolution pending retry' \}, \{ status: 503 \}\); \}/);
  assert.match(qstash, /catch \(error\) \{\s*finalStatus = 500;\s*throw error;\s*\} finally \{\s*await recordJobRun\(job, 'qstash', finalStatus\);/);
  assert.doesNotMatch(qstash, /recordJobRun\(job, 'qstash', response\.status\)/);
});

test('the run table stores only names, timestamps, a status and counters', () => {
  const migration = readFileSync('lib/db/migrations/0084_cron_job_runs.sql', 'utf8');
  const columns = [...migration.matchAll(/^\t"([a-z_]+)" /gm)].map((match) => match[1]);
  assert.deepEqual(columns, ['job', 'source', 'last_run_at', 'last_status', 'last_success_at', 'runs_total', 'failures_total', 'consecutive_failures']);
  assert.match(migration, /CHECK \("idoc"\."cron_job_runs"\."source" IN \('vercel', 'qstash'\)\)/);
  assert.match(migration, /PRIMARY KEY\("job","source"\)/);
});
