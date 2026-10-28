import Link from 'next/link';
import { MembershipHealthFilters } from './membership-health-filters';
import { getMembershipHealthReport, parseHealthRange, type RenewalCycle } from '@/lib/membership/health-report';

type Tab = 'overview' | 'tracking' | 'issues' | 'notifications' | 'cohorts';
type Params = { from?: string | string[]; to?: string | string[]; tab?: string | string[] };
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tracking', label: 'Renewal Tracking' },
  { id: 'issues', label: 'Issues & Alerts' },
  { id: 'notifications', label: 'Notification Performance' },
  { id: 'cohorts', label: 'Trends & Cohorts' },
];
const date = (value: string | null) => value ? value.slice(0, 10) : '—';
const single = (value?: string | string[]) => typeof value === 'string' ? value : undefined;
const int = (value: number) => new Intl.NumberFormat('en').format(value);
const percentage = (numerator: number, denominator: number) => denominator ? `${(numerator * 100 / denominator).toFixed(1)}%` : '—';
function MemberLink({ cycle }: { cycle: RenewalCycle }) {
  return <Link className="font-medium text-foreground underline-offset-2 hover:underline" href={`/admin/members?profileId=${cycle.profile_id}`}>{cycle.member || cycle.email}</Link>;
}
function Metric({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <article className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-2 text-xs text-muted-foreground">{note}</p></article>;
}
function Table({ headings, children }: { headings: string[]; children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-lg border"><table className="min-w-full text-left text-sm"><thead className="bg-muted/40"><tr>{headings.map((heading) => <th className="whitespace-nowrap px-3 py-3 font-medium" key={heading}>{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{children}</tbody></table></div>;
}
function Cell({ children }: { children: React.ReactNode }) { return <td className="px-3 py-3 align-top">{children}</td>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="rounded-lg border px-4 py-8 text-sm text-muted-foreground">{children}</p>; }

export default async function MembershipHealthPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const tab = TABS.find((item) => item.id === single(params.tab))?.id ?? 'overview';
  const from = single(params.from);
  const to = single(params.to);
  let error: string | null = null;
  let range: { from?: string; to?: string } = {};
  try { range = parseHealthRange(from, to); }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid date range'; }
  // PERMISSION CHECK REMAINS SERVER-SIDE EVEN IF FILTERS ARE INVALID.
  const report = await getMembershipHealthReport(error ? {} : range);
  const cycles = report.cycles;
  const due = cycles.filter((cycle) => cycle.expires_on <= new Date().toISOString().slice(0, 10));
  const paid = due.filter((cycle) => Number(cycle.payment_count) > 0);
  const attempted = due.filter((cycle) => Number(cycle.checkout_count) > 0);
  const failed = cycles.filter((cycle) => Number(cycle.failed_checkout_count) > 0 || Number(cycle.notice_failure_count) > 0);
  const imported = cycles.filter((cycle) => cycle.imported);
  const current = new URLSearchParams();
  if (range.from) current.set('from', range.from);
  if (range.to) current.set('to', range.to);
  const link = (target: Tab) => {
    const qs = new URLSearchParams(current);
    qs.set('tab', target);
    return '/admin/membership-health?' + qs.toString();
  };
  const groups = new Map<string, { due: number; paid: number; attempted: number }>();
  for (const cycle of due) {
    const month = cycle.expires_on.slice(0, 7);
    const group = groups.get(month) ?? { due: 0, paid: 0, attempted: 0 };
    group.due += 1;
    if (Number(cycle.payment_count) > 0) group.paid += 1;
    if (Number(cycle.checkout_count) > 0) group.attempted += 1;
    groups.set(month, group);
  }
  return <main className="flex-1 space-y-6 px-5 py-8 lg:px-8">
    <header>
      <p className="eyebrow">Administration</p>
      <h1 className="mt-2 font-display text-3xl text-gold">Membership Health</h1>
      <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground">Investigate renewal notices, checkout attempts, recorded payments and unresolved Stripe reconciliation findings. A sent notification does not prove delivery, and a payment does not independently prove entitlement was extended.</p>
    </header>
    <MembershipHealthFilters from={range.from} to={range.to} />
    {error && <p role="alert" className="rounded-md border border-red-500 p-3 text-sm text-red-600">{error}</p>}
    <nav aria-label="Membership Health sections" className="flex flex-wrap gap-2 border-b pb-3">{TABS.map((item) => <Link aria-current={tab === item.id ? 'page' : undefined} className={`rounded-md border px-3 py-2 text-sm ${tab === item.id ? 'border-gold text-gold' : 'border-border text-muted-foreground hover:text-foreground'}`} href={link(item.id)} key={item.id}>{item.label}</Link>)}</nav>
    {tab === 'overview' && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Renewal periods reached" value={int(due.length)} note="Expiration dates on or before today within selected range" />
        <Metric label="Recorded payment in renewal window" value={int(paid.length)} note={percentage(paid.length, due.length) + ' of reached expiration periods; not verified renewal conversion'} />
        <Metric label="Checkout attempted" value={int(attempted.length)} note={percentage(attempted.length, due.length) + ' of reached expiration periods'} />
        <Metric label="Problems with evidence" value={int(failed.length + report.findings.length)} note="Failed checkout/notice signals plus current reconciliation findings; may overlap" />
      </div>
      <section className="space-y-3"><h2 className="text-xl font-semibold">Renewal lifecycle</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Notices recorded" value={int(report.notices.length)} note="Most recent 2,000 in selected date range" />
          <Metric label="Checkout sessions created" value={int(report.checkoutAttempts)} note="Includes unsuccessful and incomplete sessions" />
          <Metric label="Completed checkouts" value={int(report.completedCheckouts)} note="Checkout state, not an entitlement guarantee" />
          <Metric label="Payments recorded" value={int(report.payments)} note="Excludes imported legacy payment history" />
        </div>
      </section>
      <section className="space-y-3"><h2 className="text-xl font-semibold">Attention required</h2>
        {report.findings.length === 0 && failed.length === 0 ? <Empty>No recorded reconciliation findings or checkout/notice failure signals.</Empty> : <>
          <p className="text-sm text-muted-foreground">{report.findings.length} current reconciliation findings and {failed.length} renewal periods with observed failure signals. Reconciliation findings are always visible regardless of the selected dates.</p>
          <Link className="idoc-secondary-button inline-block px-4 py-2 text-sm" href={link('issues')}>Investigate issues</Link>
        </>}
      </section>
    </>}
    {tab === 'tracking' && <section className="space-y-3"><h2 className="text-xl font-semibold">Renewal Tracking</h2><p className="text-sm text-muted-foreground">One row per member and expiration date. Historical notices, attempts and payments are associated using a 45-day pre-expiration and 35-day post-expiration observation window. This is evidence correlation, not proof of causation. Up to 2,000 periods are displayed.</p>
      {cycles.length ? <Table headings={['Member','Expiration','Status','Notices sent','Checkout attempts','Recorded payments','Last payment','Investigation']}>{cycles.map((cycle) => <tr key={cycle.profile_id + ':' + cycle.expires_on}><Cell><MemberLink cycle={cycle}/><p className="text-xs text-muted-foreground">{cycle.email}</p></Cell><Cell>{cycle.expires_on}</Cell><Cell>{cycle.status}</Cell><Cell>{cycle.notice_sent} / {cycle.notice_count}</Cell><Cell>{cycle.checkout_count}{Number(cycle.failed_checkout_count) ? <span className="text-red-500"> ({cycle.failed_checkout_count} failed)</span> : null}</Cell><Cell>{cycle.payment_count}</Cell><Cell>{date(cycle.last_payment)}</Cell><Cell><Link className="underline" href={`/admin/members?profileId=${cycle.profile_id}&tab=notifications`}>Member history</Link></Cell></tr>)}</Table> : <Empty>No renewal periods match the selected expiration date range.</Empty>}
    </section>}
    {tab === 'issues' && <section className="space-y-4"><h2 className="text-xl font-semibold">Issues & Alerts</h2><p className="text-sm text-muted-foreground">Open reconciliation findings are not limited by the date filter. Resolve or ignore financial findings through the existing Stripe reconciliation workflow; historical failures below remain investigation signals rather than independent incidents.</p>
      <Link className="idoc-secondary-button inline-block px-4 py-2 text-sm" href="/admin/reconciliation">Open Stripe reconciliation</Link>
      {report.findings.length ? <Table headings={['Detected','Issue','Member','Detail']}>{report.findings.map((finding) => <tr key={finding.id}><Cell>{date(finding.created_at)}</Cell><Cell>{finding.kind.replaceAll('_',' ')}</Cell><Cell>{finding.profile_id ? <Link className="underline" href={`/admin/members?profileId=${finding.profile_id}`}>{finding.member}</Link> : finding.member}</Cell><Cell>{finding.summary}</Cell></tr>)}</Table> : <Empty>No current renewal-related reconciliation findings.</Empty>}
      <h3 className="text-lg font-semibold">Checkout and notice failure signals in selected expiration range</h3>
      {failed.length ? <Table headings={['Member','Expiration','Failed checkout sessions','Notice errors','Investigate']}>{failed.map((cycle) => <tr key={cycle.profile_id + ':' + cycle.expires_on}><Cell><MemberLink cycle={cycle}/></Cell><Cell>{cycle.expires_on}</Cell><Cell>{cycle.failed_checkout_count}</Cell><Cell>{cycle.notice_failure_count}</Cell><Cell><Link className="underline" href={`/admin/members?profileId=${cycle.profile_id}&tab=notifications`}>Open member history</Link></Cell></tr>)}</Table> : <Empty>No failed checkout or notice signals matched this expiration period range.</Empty>}
    </section>}
    {tab === 'notifications' && <section className="space-y-4"><h2 className="text-xl font-semibold">Notification Performance</h2><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Notices queued" value={report.notices.length} note="Up to 2,000 notice records shown" /><Metric label="Marked sent" value={report.notices.filter((notice) => notice.sent_at).length} note="Outbox send state, not inbox delivery" /><Metric label="Pending" value={report.pendingNotices} note="Not yet sent and not dead-lettered" /><Metric label="Failed" value={report.bouncedNotices} note="Outbox dead-lettered; not the same as Brevo bounce" /></div>
      <p className="text-sm text-muted-foreground">To verify Brevo's delivered/bounced/blocked status, use the existing Communications delivery report. The payment-after-notice column is temporal correlation only; it is not evidence the email caused the renewal.</p>
      <Link className="idoc-secondary-button inline-block px-4 py-2 text-sm" href="/admin/communications">View Brevo delivery checks</Link>
      {report.notices.length ? <Table headings={['Queued','Member','Notice','Outbox state','Paid afterward','History']}>{report.notices.map((notice) => <tr key={notice.id}><Cell>{date(notice.created_at)}</Cell><Cell>{notice.member}<p className="text-xs text-muted-foreground">{notice.email}</p></Cell><Cell>{notice.kind.replace('membership.','').replaceAll('_',' ')}</Cell><Cell>{notice.status}</Cell><Cell>{notice.paid_after ? 'Yes' : 'Not recorded'}</Cell><Cell><Link className="underline" href={`/admin/members?profileId=${notice.profile_id}&tab=notifications`}>Investigate</Link></Cell></tr>)}</Table> : <Empty>No renewal notices were created within the selected date range.</Empty>}
    </section>}
    {tab === 'cohorts' && <section className="space-y-4"><h2 className="text-xl font-semibold">Trends & Cohorts</h2><p className="text-sm text-muted-foreground">Only expiration months that have passed are counted as due. Recorded payments in a renewal observation window are not a verified successful renewal rate. Recent months may be incomplete due to grace periods and pending payments.</p>
      {groups.size ? <Table headings={['Expiration month','Renewal periods due','Checkout attempted','Payment recorded','Payment evidence rate']}>{[...groups.entries()].sort(([a],[b]) => b.localeCompare(a)).map(([month, group]) => <tr key={month}><Cell>{month}</Cell><Cell>{group.due}</Cell><Cell>{group.attempted}</Cell><Cell>{group.paid}</Cell><Cell>{percentage(group.paid, group.due)}</Cell></tr>)}</Table> : <Empty>No completed expiration months or due renewal periods in the date range.</Empty>}
      <h3 className="text-lg font-semibold">Legacy-imported members</h3><div className="grid gap-4 sm:grid-cols-3"><Metric label="Imported expiration periods" value={imported.length} note="Within selected expiration range" /><Metric label="Imported with payment evidence" value={imported.filter((row) => Number(row.payment_count) > 0).length} note="Excludes legacy-import payment history" /><Metric label="Imported with checkout attempts" value={imported.filter((row) => Number(row.checkout_count) > 0).length} note="Potential activation or billing follow-up" /></div>
      <p className="text-sm text-muted-foreground">Member classification is taken from each membership period, not the member's current classification. Geographic and renewal-mode segments can be added once period-specific historical attribution is confirmed.</p>
    </section>}
    <p className="text-xs text-muted-foreground">Read-only operational report. Historical row displays are limited to 2,000 per list to keep administration responsive; aggregate payment and checkout counts cover the selected period. No billing operations are performed here.</p>
  </main>;
}
