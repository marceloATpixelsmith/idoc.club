import { CommunicationsTabs } from './communications-tabs';
import { DeliveryIssuesTable, SentNoticesTable, UpcomingNoticesTable } from './communications-tables';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { getCommunicationsReport, UPCOMING_DAYS } from '@/lib/notifications/communications-report-data';
import { BREVO_CHECK_LABELS, type KindTotals } from '@/lib/notifications/communications-report';
import { memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';

export const dynamic = 'force-dynamic';

const utc = (date: Date) => `${date.toISOString().slice(8, 10)}/${date.toISOString().slice(5, 7)}/${date.toISOString().slice(0, 4)} ${date.toISOString().slice(11, 16)} UTC`;
const isoToDisplay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

type Totals = { delivered: number | string; failed: number | string; pending: number; sent: number };

function Stat({ label, value }: { label: string; value: number | string }) {
  return <article className="rounded-lg border p-4"><h3 className="text-sm text-muted-foreground">{label}</h3><p className="mt-1 text-2xl font-semibold">{value}</p></article>;
}

function sum(totals: KindTotals[], key: 'brevoDelivered' | 'brevoFailed' | 'brevoNotFound' | 'brevoUnavailable' | 'failedToSend' | 'pending' | 'sent') {
  return totals.reduce((total, row) => total + row[key], 0);
}

function summaryOf(totals: KindTotals[], brevoAvailable: boolean): Totals {
  return { delivered: brevoAvailable ? sum(totals, 'brevoDelivered') : '—', failed: brevoAvailable ? sum(totals, 'brevoFailed') : '—', pending: sum(totals, 'pending') + sum(totals, 'failedToSend'), sent: sum(totals, 'sent') };
}

/** Counts only, so the boxes size to their content and wrap onto their own rows when the screen is narrow. */
function CountsSection({ caption, description, title, totals, summary }: { caption: string; description: string; summary: Totals; title: string; totals: KindTotals[] }) {
  return <div className="flex flex-wrap items-start gap-6">
    <div className="w-full max-w-md"><AdminFormSection description={description} title={title}>
      <div className="grid grid-cols-2 gap-3"><Stat label="Sent" value={summary.sent} /><Stat label="Delivered (Brevo)" value={summary.delivered} /><Stat label="Bounced / blocked" value={summary.failed} /><Stat label="Pending or failed to send" value={summary.pending} /></div>
    </AdminFormSection></div>
    <div className="min-w-0 max-w-full"><AdminFormSection description="Each row is one kind of email." title="By email type">
      {totals.length === 0 ? <p className="text-sm text-muted-foreground">Nothing was sent in this period.</p> : <div className="overflow-x-auto"><table className="w-auto border text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th className="p-2 pr-8 text-left">Email type</th><th className="p-2 pl-6 text-right">Sent</th><th className="p-2 pl-6 text-right">Delivered (Brevo)</th><th className="p-2 pl-6 text-right">Bounced / blocked</th><th className="p-2 pl-6 text-right">Not in Brevo log</th><th className="p-2 pl-6 text-right">Pending</th><th className="p-2 pl-6 text-right">Failed to send</th></tr></thead>
        <tbody>{totals.map((row) => <tr className="border-t" key={row.kind}>
          <td className="p-2 pr-8">{row.label}</td><td className="p-2 pl-6 text-right">{row.sent}</td>
          <td className="p-2 pl-6 text-right">{row.brevoUnavailable > 0 && row.brevoDelivered === 0 ? '—' : row.brevoDelivered}</td>
          <td className="p-2 pl-6 text-right">{row.brevoFailed}</td><td className="p-2 pl-6 text-right">{row.brevoNotFound}</td><td className="p-2 pl-6 text-right">{row.pending}</td><td className="p-2 pl-6 text-right">{row.failedToSend}</td>
        </tr>)}</tbody>
      </table></div>}
    </AdminFormSection></div>
  </div>;
}

const queueLabel = (status: 'failed' | 'pending' | 'sent') => (status === 'sent' ? 'Sent' : status === 'failed' ? 'Failed (gave up)' : 'Pending');

export default async function CommunicationsPage() {
  const report = await getCommunicationsReport();
  const issueCounts = { renewal: report.issueRows.filter((row) => row.group === 'Renewal notice').length, system: report.issueRows.filter((row) => row.group === 'System email').length };
  return <main className="flex-1 py-8 px-5 lg:px-8">
    <h1 className="text-3xl font-semibold text-gold">Communications</h1>
    <p className="mt-2 text-sm text-muted-foreground">Emails the system sent from {utc(report.from)} to {utc(report.to)}, checked against Brevo&apos;s transactional log by recipient address and time.</p>
    {memberCommunicationsDisabled() ? <p className="mt-3 rounded-md border border-gold p-3 text-sm" role="status">Member communications are on hold in this environment, so member emails are not being sent and renewal notices stay queued until the hold is released.</p> : null}
    {report.brevoAvailable ? null : <p className="mt-3 rounded-md border border-destructive p-3 text-sm" role="alert">Brevo&apos;s log could not be read (the API key is missing or Brevo did not answer). Sent counts below come from this system&apos;s own queue and are not confirmed against Brevo.</p>}

    <div className="mt-6"><CommunicationsTabs issueCounts={issueCounts} panels={{
      system: <CountsSection caption="System email totals by type for the last 7 days" description="Everything except renewal notices, over the last 7 days." summary={summaryOf(report.systemTotals, report.brevoAvailable)} title="System emails, last 7 days" totals={report.systemTotals} />,
      renewal: <>
        <CountsSection caption="Renewal notice totals by type for the last 7 days" description="Renewal, expiration and grace reminders, over the last 7 days." summary={summaryOf(report.renewalTotals, report.brevoAvailable)} title="Renewal notices sent, last 7 days" totals={report.renewalTotals} />
        <AdminFormSection description="Every renewal notice sent or queued in the last 7 days, one row per email." title="Renewal notice list">
          <SentNoticesTable rows={report.renewalRows.map((row, index) => ({ brevo: row.brevo ? BREVO_CHECK_LABELS[row.brevo] : undefined, email: row.email ?? undefined, id: `sent-${index}`, member: row.member, notice: row.label, queue: queueLabel(row.status), sent: row.sentAt?.toISOString() }))} />
        </AdminFormSection>
      </>,
      upcoming: <AdminFormSection description={`Notices the daily scan has not queued yet, by the date it will queue them. A member already inside a notice window goes out on the next scan. Showing the next ${UPCOMING_DAYS} days.`} title="Renewal notices going out soon">
        <UpcomingNoticesTable rows={report.upcoming.map((row, index) => ({ email: row.email, goesOut: `${row.sendOn}T00:00:00.000Z`, id: `upcoming-${index}`, member: row.member, notice: row.label, target: isoToDisplay(row.targetDate) }))} />
      </AdminFormSection>,
      issues: <AdminFormSection description="Every email from the last 7 days that Brevo did not confirm as delivered (bounced or blocked, missing from Brevo's log), plus emails still queued or given up on. Use the address to look the message up in Brevo's transactional log." title="Emails to investigate">
        {report.brevoAvailable && report.issueRows.length === 0 ? <p className="rounded-lg border border-emerald-400/40 bg-emerald-950/20 p-4 text-sm text-emerald-200" role="status">Every email sent in this period was confirmed as delivered by Brevo.</p> : null}
        <DeliveryIssuesTable rows={report.issueRows.map((row, index) => ({ brevo: row.brevo ? BREVO_CHECK_LABELS[row.brevo] : undefined, email: row.email ?? undefined, group: row.group, id: `issue-${index}`, member: row.member, notice: row.label, queue: queueLabel(row.status), sent: row.sentAt?.toISOString() }))} />
      </AdminFormSection>,
    }} /></div>
  </main>;
}
