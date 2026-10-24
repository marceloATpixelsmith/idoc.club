import { SentNoticesTable, UpcomingNoticesTable } from './communications-tables';
import { getCommunicationsReport, UPCOMING_DAYS } from '@/lib/notifications/communications-report-data';
import { BREVO_CHECK_LABELS, type KindTotals } from '@/lib/notifications/communications-report';
import { memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';

export const dynamic = 'force-dynamic';

const utc = (date: Date) => `${date.toISOString().slice(8, 10)}/${date.toISOString().slice(5, 7)}/${date.toISOString().slice(0, 4)} ${date.toISOString().slice(11, 16)} UTC`;
const isoToDisplay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function Stat({ label, value }: { label: string; value: number | string }) {
  return <article className="rounded-lg border p-4"><h3 className="text-sm text-muted-foreground">{label}</h3><p className="mt-1 text-2xl font-semibold">{value}</p></article>;
}

function sum(totals: KindTotals[], key: 'brevoDelivered' | 'brevoFailed' | 'brevoNotFound' | 'brevoUnavailable' | 'failedToSend' | 'pending' | 'sent') {
  return totals.reduce((total, row) => total + row[key], 0);
}

function TotalsTable({ caption, totals }: { caption: string; totals: KindTotals[] }) {
  if (totals.length === 0) return <p className="mt-2 text-sm text-muted-foreground">Nothing was sent in this period.</p>;
  return <div className="mt-3 overflow-x-auto"><table className="min-w-full border text-sm">
    <caption className="sr-only">{caption}</caption>
    <thead><tr><th className="p-2 text-left">Email type</th><th className="p-2 text-right">Sent</th><th className="p-2 text-right">Delivered (Brevo)</th><th className="p-2 text-right">Bounced / blocked</th><th className="p-2 text-right">Not in Brevo log</th><th className="p-2 text-right">Pending</th><th className="p-2 text-right">Failed to send</th></tr></thead>
    <tbody>{totals.map((row) => <tr className="border-t" key={row.kind}>
      <td className="p-2">{row.label}</td><td className="p-2 text-right">{row.sent}</td>
      <td className="p-2 text-right">{row.brevoUnavailable > 0 && row.brevoDelivered === 0 ? '—' : row.brevoDelivered}</td>
      <td className="p-2 text-right">{row.brevoFailed}</td><td className="p-2 text-right">{row.brevoNotFound}</td><td className="p-2 text-right">{row.pending}</td><td className="p-2 text-right">{row.failedToSend}</td>
    </tr>)}</tbody>
  </table></div>;
}

export default async function CommunicationsPage() {
  const report = await getCommunicationsReport();
  const systemSent = sum(report.systemTotals, 'sent');
  const renewalSent = sum(report.renewalTotals, 'sent');
  return <main className="flex-1 py-8 px-5 lg:px-8">
    <h1 className="text-3xl font-semibold text-gold">Communications</h1>
    <p className="mt-2 text-sm text-muted-foreground">Emails the system sent from {utc(report.from)} to {utc(report.to)}, checked against Brevo&apos;s transactional log by recipient address and time.</p>
    {memberCommunicationsDisabled() ? <p className="mt-3 rounded-md border border-gold p-3 text-sm" role="status">Member communications are on hold in this environment, so member emails are not being sent and renewal notices stay queued until the hold is released.</p> : null}
    {report.brevoAvailable ? null : <p className="mt-3 rounded-md border border-destructive p-3 text-sm" role="alert">Brevo&apos;s log could not be read (the API key is missing or Brevo did not answer). Sent counts below come from this system&apos;s own queue and are not confirmed against Brevo.</p>}

    <h2 className="mt-8 text-lg font-medium">System emails, last 7 days</h2>
    <section aria-label="System email summary" className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Sent" value={systemSent} /><Stat label="Delivered (Brevo)" value={report.brevoAvailable ? sum(report.systemTotals, 'brevoDelivered') : '—'} />
      <Stat label="Bounced / blocked" value={report.brevoAvailable ? sum(report.systemTotals, 'brevoFailed') : '—'} /><Stat label="Pending or failed to send" value={sum(report.systemTotals, 'pending') + sum(report.systemTotals, 'failedToSend')} />
    </section>
    <TotalsTable caption="System email totals by type for the last 7 days" totals={report.systemTotals} />

    <h2 className="mt-10 text-lg font-medium">Renewal notices sent, last 7 days</h2>
    <section aria-label="Renewal notice summary" className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Sent" value={renewalSent} /><Stat label="Delivered (Brevo)" value={report.brevoAvailable ? sum(report.renewalTotals, 'brevoDelivered') : '—'} />
      <Stat label="Bounced / blocked" value={report.brevoAvailable ? sum(report.renewalTotals, 'brevoFailed') : '—'} /><Stat label="Pending or failed to send" value={sum(report.renewalTotals, 'pending') + sum(report.renewalTotals, 'failedToSend')} />
    </section>
    <TotalsTable caption="Renewal notice totals by type for the last 7 days" totals={report.renewalTotals} />
    <div className="mt-4"><SentNoticesTable rows={report.renewalRows.map((row, index) => ({ brevo: row.brevo ? BREVO_CHECK_LABELS[row.brevo] : undefined, email: row.email ?? undefined, id: `sent-${index}`, member: row.member, notice: row.label, queue: row.status === 'sent' ? 'Sent' : row.status === 'failed' ? 'Failed (gave up)' : 'Pending', sent: row.sentAt?.toISOString() }))} /></div>

    <h2 className="mt-10 text-lg font-medium">Renewal notices going out in the next {UPCOMING_DAYS} days</h2>
    <p className="mt-1 text-sm text-muted-foreground">Notices the daily scan has not queued yet, by the date it will queue them. A member already inside a notice window goes out on the next scan.</p>
    <div className="mt-4"><UpcomingNoticesTable rows={report.upcoming.map((row, index) => ({ email: row.email, goesOut: `${row.sendOn}T00:00:00.000Z`, id: `upcoming-${index}`, member: row.member, notice: row.label, target: isoToDisplay(row.targetDate) }))} /></div>
  </main>;
}
