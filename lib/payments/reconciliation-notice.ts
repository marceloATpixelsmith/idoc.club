import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { getDatabaseSchemaName } from '@/lib/db/schema-name';
import { applicationRoles, auditLog, reconciliationFindings, users } from '@/lib/db/schema';
import { sendTransactionalEmail } from '@/lib/notifications/brevo-transactional';
import { emailButton, emailNoticeCard, escapeHtml, idocEmailAssetUrl, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { logWarn } from '@/lib/observability/logger';
import { RECONCILIATION_KIND_LABELS } from './reconciliation-report';

const SEND_TIMEOUT_MS = 5_000;
const ENVIRONMENT_LABELS: Record<string, string> = { idoc: 'Development', idoc_staging: 'Staging', idoc_production: 'Production' };

const ACTION_LABELS: Record<string, string> = {
  subscription_status_synced: 'Subscription status copied from Stripe',
  subscription_marked_canceled: 'Subscriptions missing from Stripe marked cancelled',
  renewal_change_completed: 'Renewal changes completed',
  renewal_change_reverted: 'Waiting renewal changes dropped',
  seminar_payment_recorded: 'Seminar payments recorded',
  orphan_subscription_canceled: 'Orphaned Stripe subscriptions cancelled',
  unlinked_customer_deleted: 'Unlinked Stripe customers deleted',
};

/** Active Super Admin email addresses: the people who follow up on the report. */
async function superAdminEmails(): Promise<string[]> {
  const rows = await db.select({ email: users.email, emailDisplay: users.emailDisplay }).from(applicationRoles)
    .innerJoin(users, eq(users.id, applicationRoles.userId))
    .where(and(eq(applicationRoles.role, 'super_admin'), isNull(applicationRoles.revokedAt)));
  return [...new Set(rows.map((row) => (row.emailDisplay ?? row.email).trim()).filter(Boolean))];
}

/** Emails every Super Admin after a scheduled reconciliation scan: what is waiting for a person, and what the scan resolved by itself. Best effort: a missing
 * mail configuration, the member-communications hold or a provider error is logged and never fails the scan. Contains counts only, no member details. */
export async function notifySuperAdminsOfScan(outcome: { error?: string; ok: boolean }): Promise<number> {
  try {
    const recipients = await superAdminEmails();
    if (recipients.length === 0) return 0;
    const environment = ENVIRONMENT_LABELS[getDatabaseSchemaName()] ?? 'Unknown';
    const link = idocEmailAssetUrl('/admin/reconciliation');
    let subject: string;
    let bodyHtml: string;
    if (!outcome.ok) {
      subject = `IDOC ${environment}: Stripe reconciliation scan FAILED`;
      bodyHtml = `<p>The scheduled Stripe reconciliation scan failed. The report shows the previous run until the next one succeeds.</p>${emailNoticeCard('Error', `<p>${escapeHtml(outcome.error ?? 'Unknown error')}</p>`)}${emailButton(link, 'Open reconciliation')}`;
    } else {
      const counts = await db.select({ kind: reconciliationFindings.kind, total: sql<number>`count(*)::int` }).from(reconciliationFindings).groupBy(reconciliationFindings.kind);
      const total = counts.reduce((sum, row) => sum + row.total, 0);
      const [resolution] = await db.select({ afterJson: auditLog.afterJson }).from(auditLog).where(eq(auditLog.action, 'reconciliation.scan_resolution_summary')).orderBy(desc(auditLog.createdAt)).limit(1);
      const resolved = (resolution?.afterJson ?? {}) as { counts?: Record<string, number>; stripeMode?: string };
      const resolvedRows = Object.entries(resolved.counts ?? {}).filter(([key]) => key.endsWith(':done') || key.endsWith(':simulated'));
      const resolvedTotal = resolvedRows.reduce((sum, [, value]) => sum + value, 0);
      subject = total === 0 ? `IDOC ${environment}: reconciliation scan finished, nothing needs follow-up` : `IDOC ${environment}: reconciliation scan finished, ${total.toLocaleString('en-GB')} item(s) need follow-up`;
      const waiting = total === 0 ? '<p>Nothing needs a person this time.</p>'
        : `<ul>${counts.sort((a, b) => b.total - a.total).map((row) => `<li>${escapeHtml(RECONCILIATION_KIND_LABELS[row.kind] ?? row.kind)}: <b>${row.total.toLocaleString('en-GB')}</b></li>`).join('')}</ul><p>Select the rows on the page and use Export selected CSV for member names, emails and the reason each needs a look.</p>`;
      const done = resolvedTotal === 0 ? '<p>The scan did not need to change anything by itself.</p>'
        : `<ul>${resolvedRows.map(([key, value]) => `<li>${escapeHtml(ACTION_LABELS[key.split(':')[0] ?? ''] ?? key)}${key.endsWith(':simulated') ? ' (simulated)' : ''}: <b>${value.toLocaleString('en-GB')}</b></li>`).join('')}</ul>${resolved.stripeMode === 'simulate' ? '<p>Changes to Stripe were only simulated in this environment.</p>' : ''}`;
      bodyHtml = `<p>The scheduled Stripe reconciliation scan has finished for <b>${escapeHtml(environment)}</b>.</p>${emailNoticeCard('Needs follow-up', waiting)}${emailNoticeCard('Resolved by the scan', done)}${emailButton(link, 'Open reconciliation')}`;
    }
    const html = renderTransactionalEmail({ bodyHtml, footerNote: 'IDOC reconciliation monitoring. Sent to Super Admins after each scheduled scan; contains counts only.', heading: 'Stripe reconciliation' });
    let sent = 0;
    for (const to of recipients) {
      try {
        await sendTransactionalEmail({ html, subject, to }, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
        sent += 1;
      } catch {
        await logWarn('reconciliation_scan_notice_failed');
      }
    }
    return sent;
  } catch {
    await logWarn('reconciliation_scan_notice_failed');
    return 0;
  }
}
