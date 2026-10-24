import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { handleAccountDeliveryCron } from '../lib/notifications/account-delivery-worker-core.ts';
import { readCronMonitor } from '../lib/observability/cron-monitor.ts';
import { recordJobRun } from '../lib/observability/job-run-record.ts';
import { closeHarness, resetIdoc, sql } from './postgres-harness.ts';

const SECRET = 'integration-cron-secret-at-least-32-characters';

beforeEach(resetIdoc);
after(closeHarness);

async function rows() {
  return sql<{ job: string; source: string; last_status: number; last_success_at: Date | null; runs_total: number; failures_total: number; consecutive_failures: number }[]>`
    select job, source, last_status, last_success_at, runs_total, failures_total, consecutive_failures from idoc.cron_job_runs order by job, source`;
}

test('each run updates one row per job and timer, counting failures and resetting the streak on success', async () => {
  await recordJobRun('clock-skew-check', 'vercel', 200);
  await recordJobRun('clock-skew-check', 'vercel', 500);
  await recordJobRun('clock-skew-check', 'vercel', 503);
  let [row] = await rows();
  assert.deepEqual({ ...row, last_success_at: row.last_success_at !== null }, {
    job: 'clock-skew-check', source: 'vercel', last_status: 503, last_success_at: true, runs_total: 3, failures_total: 2, consecutive_failures: 2,
  });
  await recordJobRun('clock-skew-check', 'vercel', 200);
  [row] = await rows();
  assert.equal(row.last_status, 200);
  assert.equal(row.runs_total, 4);
  assert.equal(row.failures_total, 2);
  assert.equal(row.consecutive_failures, 0);
});

test('the two timer systems are tracked separately and an unsuccessful first run has no success time', async () => {
  await recordJobRun('account-delivery', 'qstash', 401);
  await recordJobRun('account-delivery', 'vercel', 200);
  const result = await rows();
  assert.equal(result.length, 2);
  const qstash = result.find((row) => row.source === 'qstash')!;
  assert.equal(qstash.last_success_at, null);
  assert.equal(qstash.consecutive_failures, 1);
});

test('invalid job names and sources never create rows', async () => {
  await recordJobRun('Bad Name', 'vercel', 200);
  await recordJobRun('ok-job', 'cron' as never, 200);
  await recordJobRun('ok-job', 'vercel', Number.NaN);
  assert.equal((await rows()).length, 0);
  await assert.rejects(sql`insert into idoc.cron_job_runs (job, source, last_run_at, last_status) values ('x', 'other', now(), 200)`);
});

test('a direct Cron call is recorded after success and after failure, but never when unauthorized', async () => {
  const url = 'https://idoc.club/api/cron/data-retention-purge';
  const authorized = () => new Request(url, { headers: { authorization: `Bearer ${SECRET}` } });
  await handleAccountDeliveryCron(new Request(url), { processBatch: async () => ({}), reportFailure: () => undefined, secret: SECRET });
  assert.equal((await rows()).length, 0, 'unauthorized call must not be recorded');
  const ok = await handleAccountDeliveryCron(authorized(), { processBatch: async () => ({ done: 1 }), reportFailure: () => undefined, secret: SECRET });
  assert.equal(ok.status, 200);
  const failed = await handleAccountDeliveryCron(authorized(), { processBatch: async () => { throw new Error('boom'); }, reportFailure: () => undefined, secret: SECRET });
  assert.equal(failed.status, 500);
  const [row] = await rows();
  assert.equal(row.job, 'data-retention-purge');
  assert.equal(row.source, 'vercel');
  assert.equal(row.runs_total, 2);
  assert.equal(row.failures_total, 1);
  // A QStash-driven call carries the QStash URL, so the worker core must not record it as a Vercel run.
  await handleAccountDeliveryCron(new Request('https://idoc.club/api/qstash/jobs?job=news-scheduled-publish', { headers: { authorization: `Bearer ${SECRET}` } }),
    { processBatch: async () => ({}), reportFailure: () => undefined, secret: SECRET });
  assert.equal((await rows()).length, 1);
});

test('the monitor feed lists the recorded jobs and survives the table not existing yet', async () => {
  await recordJobRun('reconciliation-scan', 'qstash', 200);
  let feed = await readCronMonitor(30, 10);
  assert.equal(feed.jobsAvailable, true);
  assert.equal(feed.jobs.length, 1);
  assert.deepEqual(
    { job: feed.jobs[0].job, source: feed.jobs[0].source, lastStatus: feed.jobs[0].lastStatus, runs: feed.jobs[0].runs, failures: feed.jobs[0].failures, consecutiveFailures: feed.jobs[0].consecutiveFailures },
    { job: 'reconciliation-scan', source: 'qstash', lastStatus: 200, runs: 1, failures: 0, consecutiveFailures: 0 });
  assert.ok(feed.jobs[0].lastRunAt && feed.jobs[0].lastSuccessAt);
  await sql`drop table idoc.cron_job_runs`;
  feed = await readCronMonitor(30, 10);
  assert.equal(feed.jobsAvailable, false);
  assert.deepEqual(feed.jobs, []);
  await recordJobRun('reconciliation-scan', 'qstash', 200); // must not throw while the table is missing
});
