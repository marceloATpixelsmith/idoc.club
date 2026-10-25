import 'server-only';

import { sendTransactionalEmail } from '@/lib/notifications/brevo-transactional';
import { taggedSubject } from '@/lib/notifications/alert-severity';
import { detailTable } from '@/lib/notifications/admin-event-notifications';
import { escapeHtml, renderTransactionalEmail } from '@/lib/notifications/email-template';

const DELIVERY_TIMEOUT_MS = 4_000;

/** Emails the operations recipient (IDOC_ADMIN_NOTIFICATION_EMAIL) that a scheduled job failed. Never throws; skipped when unconfigured. */
export async function notifyJobFailure(input: {
  consecutiveFailures: number; failuresTotal: number; job: string; lastSuccessAt: Date | string | null; runsTotal: number; source: string; status: number;
}): Promise<void> {
  try {
    const to = process.env.IDOC_ADMIN_NOTIFICATION_EMAIL?.trim();
    if (!to) return;
    const last = input.lastSuccessAt ? new Date(input.lastSuccessAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : 'No successful run recorded yet';
    const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown';
    const html = renderTransactionalEmail({
      bodyHtml: `<p style="margin:0 0 8px;">The scheduled job <b>${escapeHtml(input.job)}</b> failed${input.consecutiveFailures > 1 ? ` and has now failed ${input.consecutiveFailures} times in a row` : ''}.</p>`
        + detailTable([
          ['Job', input.job], ['Scheduler', input.source === 'qstash' ? 'QStash' : 'Vercel Cron'], ['HTTP status returned', input.status],
          ['Consecutive failures', input.consecutiveFailures], ['Total failures / runs', `${input.failuresTotal} / ${input.runsTotal}`], ['Last successful run', last],
          ['Environment', environment], ['Site', process.env.BASE_URL], ['Failed at', new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')],
        ])
        + '<p style="margin:0;">Search the Vercel function logs or Sentry for this job\'s path (/api/cron/&hellip;) around the time above. QStash retries the job automatically; you are emailed again only if it keeps failing (5th, 25th and 100th consecutive failure) and when it recovers you receive no further message.</p>',
      footerNote: 'IDOC job monitoring. No request data, secrets or member information is included in this message.',
      heading: 'Scheduled job failed',
    });
    await sendTransactionalEmail({ html, messageId: `job-failure-${input.job}-${input.source}-${input.consecutiveFailures}`, subject: taggedSubject('operations.job_failed', `IDOC: scheduled job failed — ${input.job} (${environment})`), to },
      { signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS) });
  } catch {
    // Best-effort only.
  }
}
