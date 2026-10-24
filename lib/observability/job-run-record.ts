import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { cronJobRuns } from '@/lib/db/schema';
import { runSucceeded, validJobName, type JobRunSource } from './job-run-record-core';

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
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([write.then(() => undefined), new Promise<void>((resolve) => { timer = setTimeout(resolve, RECORD_TIMEOUT_MS); })]);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Best-effort only.
  }
}
