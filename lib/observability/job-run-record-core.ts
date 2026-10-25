// Pure helpers for recording scheduled-job runs (lib/observability/job-run-record.ts). No database or server-only imports so the
// unit tests can load them directly.

export type JobRunSource = 'vercel' | 'qstash';

// Job names are fixed code-defined identifiers; anything else is refused so a request can never create arbitrary rows.
const JOB_NAME = /^[a-z][a-z0-9-]{0,59}$/;

export function validJobName(value: unknown): value is string {
  return typeof value === 'string' && JOB_NAME.test(value);
}

/** The job behind a direct Vercel Cron call (/api/cron/<job>); null for any other path, including the QStash route. */
export function vercelCronJobFromUrl(url: string): string | null {
  let pathname: string;
  try { pathname = new URL(url).pathname; } catch { return null; }
  const match = /^\/api\/cron\/([a-z0-9-]+)\/?$/.exec(pathname);
  return match && validJobName(match[1]) ? match[1] : null;
}

/** A run counts as successful only for a 2xx response. */
export function runSucceeded(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

/** Alert on the first failure, then again at the 5th, 25th and 100th consecutive failure -- never on every retry of a job that stays broken. */
export function shouldAlertJobFailure(consecutiveFailures: number): boolean {
  return [1, 5, 25, 100].includes(consecutiveFailures);
}
