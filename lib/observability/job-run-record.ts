import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { cronJobRuns } from '@/lib/db/schema';
import { notifyJobFailure } from './job-failure-alert';
import { runSucceeded, shouldAlertJobFailure, validJobName, type JobRunSource } from './job-run-record-core';

const RECORD_TIMEOUT_MS = 2000;

/** Upserts the latest run of one job. Never throws and never waits longer than two seconds: recording must not change or delay
 * job behaviour, and it must keep working before the migration that creates the table has reached this environment. */
export async function recordJobRun(job: string, source: JobRunSource, status: number, now: Date = new Date()): Promise<void> {
  try {
    if (!validJobName(job) || !Number.isInteger(status)) return;
    const ok = runSucceeded(status);
    const write = db.insert(cronJobRuns).values({
      job, source, lastRunAt: now, lastStatus: status, lastSuccessAt: ok ? now : null,
      runsTotal: 1, failuresTotal: ok ? 0 : 1, consecutiveFailures: ok ? 0 : 1,
    }).onConflictDoUpdate({
      target: [cronJobRuns.job, cronJobRuns.source],
      set: {
        lastRunAt: now,
        lastStatus: status,
        lastSuccessAt: ok ? now : sql`${cronJobRuns.lastSuccessAt}`,
        runsTotal: sql`${cronJobRuns.runsTotal} + 1`,
        failuresTotal: ok ? sql`${cronJobRuns.failuresTotal}` : sql`${cronJobRuns.failuresTotal} + 1`,
        consecutiveFailures: ok ? 0 : sql`${cronJobRuns.consecutiveFailures} + 1`,
      },
    }).returning({ consecutiveFailures: cronJobRuns.consecutiveFailures, failuresTotal: cronJobRuns.failuresTotal, lastSuccessAt: cronJobRuns.lastSuccessAt, runsTotal: cronJobRuns.runsTotal });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const recorded = await Promise.race([write, new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), RECORD_TIMEOUT_MS); })]);
      // Email IDOC_ADMIN_NOTIFICATION_EMAIL as soon as a job starts failing (and again if it keeps failing), not only when someone reads the monitor.
      const row = recorded?.[0];
      if (!ok && row && shouldAlertJobFailure(row.consecutiveFailures)) {
        await notifyJobFailure({ consecutiveFailures: row.consecutiveFailures, failuresTotal: row.failuresTotal, job, lastSuccessAt: row.lastSuccessAt, runsTotal: row.runsTotal, source, status });
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Best-effort only.
  }
}
