import Link from 'next/link';
import { AdminReadOnlyTable, type ReadOnlyRow } from '@/components/admin/admin-read-only-table';
import { getTablePreferences } from '@/lib/admin/table-preferences';
import { getMembershipHealthReport, parseHealthRange } from '@/lib/membership/health-report';
import { getMemberJourneyConcerns } from '@/lib/notifications/member-journey-health';
import { getMembershipHealthCases } from '@/lib/membership/health-cases';
import { MembershipHealthCaseDrawer } from './membership-health-case-drawer';
import { MembershipHealthFilters } from './membership-health-filters';

type Tab = 'overview' | 'tracking' | 'issues' | 'notifications' | 'cohorts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tracking', label: 'Renewal Tracking' },
  { id: 'issues', label: 'Issues & Alerts' },
  { id: 'notifications', label: 'Notification Performance' },
  { id: 'cohorts', label: 'Trends & Cohorts' },
];
const today = () => new Date().toISOString().slice(0, 10);
const int = (value: number) => new Intl.NumberFormat('en').format(value);
const percentage = (num: number, den: number) => den ? `${(num * 100 / den).toFixed(1)}%` : '—';
const isoTimestamp = (value: string | null) => value ? value.slice(0, 10) + 'T00:00:00.000Z' : undefined;
function Metric({ label, value, note }: { label: string; value: number | string; note: string }) {
  return <article className="rounded-lg border p-4"><h3 className="text-sm text-muted-foreground">{label}</h3><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-2 text-xs text-muted-foreground">{note}</p></article>;
}
function Empty({ children }: { children: React.ReactNode }) { return <p className="rounded-lg border p-5 text-sm text-muted-foreground">{children}</p>; }
function heading(value: string) { return <h2 className="text-xl font-semibold">{value}</h2>; }

export default async function MembershipHealthPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; caseId?: string | string[] }> }) {
  const params = await searchParams;
  const tab = TABS.find((value) => value.id === params.tab)?.id ?? 'overview';
  const [savedRange, casePrefs, trackingPrefs, issuePrefs, noticePrefs, cohortPrefs] = await Promise.all([
    getTablePreferences('membership_health_cases'),
    getTablePreferences('membership_health_range'),
    getTablePreferences('membership_health_tracking'),
    getTablePreferences('membership_health_issues'),
    getTablePreferences('membership_health_notifications'),
    getTablePreferences('membership_health_cohorts'),
  ]);
  const range = parseHealthRange(
    typeof savedRange?.from === 'string' ? savedRange.from : undefined,
    typeof savedRange?.to === 'string' ? savedRange.to : undefined,
  );
  const [report, journeyConcerns, cases] = await Promise.all([getMembershipHealthReport(range), getMemberJourneyConcerns(), getMembershipHealthCases()]);
  const selectedCase = typeof params.caseId === 'string' && /^\d{1,9}$/.test(params.caseId)
    ? cases.find((item) => item.id === Number(params.caseId)) : undefined;
  const openCases = cases.filter((item) => item.status === 'new' || item.status === 'investigating');
  const caseRows: ReadOnlyRow[] = cases.map((item) => ({
    id: String(item.id), member: item.title, link: `/admin/membership-health?tab=issues&caseId=${item.id}`,
    severity: item.severity, status: item.status, type: item.kind.replaceAll('_', ' '),
    owner: item.assigned_email ?? 'Unassigned', detected: isoTimestamp(item.first_seen_at),
    lastSeen: isoTimestamp(item.last_seen_at),
  }));
  const periods = report.cycles;
  const due = periods.filter((cycle) => cycle.expires_on <= today());
  const paid = due.filter((cycle) => Number(cycle.payment_count) > 0);
  const attempted = due.filter((cycle) => Number(cycle.checkout_count) > 0);
  const failures = periods.filter((cycle) => Number(cycle.failed_checkout_count) > 0 || Number(cycle.notice_failure_count) > 0);
  const renewalConcerns = journeyConcerns.filter((concern) => concern.kind.startsWith('renewal_'));
  const imported = periods.filter((cycle) => cycle.imported);
  const groups = new Map<string, { count: number; paid: number; attempted: number }>();
  for (const cycle of due) {
    const key = cycle.expires_on.slice(0, 7);
    const group = groups.get(key) ?? { count: 0, paid: 0, attempted: 0 };
    group.count += 1;
    if (Number(cycle.payment_count) > 0) group.paid += 1;
    if (Number(cycle.checkout_count) > 0) group.attempted += 1;
    groups.set(key, group);
  }
  const trackingRows: ReadOnlyRow[] = periods.slice(0, 2000).map((cycle) => ({
    id: cycle.profile_id + ':' + cycle.expires_on,
    member: cycle.member || cycle.email, link: `/admin/members?profileId=${cycle.profile_id}`,
    email: cycle.email, expiration: isoTimestamp(cycle.expires_on), status: cycle.status,
    imported: cycle.imported ? 'Legacy import' : 'New account', classification: cycle.classification,
    notices: `${cycle.notice_sent} / ${cycle.notice_count}`, checkout: String(cycle.checkout_count),
    checkoutFailures: String(cycle.failed_checkout_count), payments: String(cycle.payment_count),
    lastPayment: isoTimestamp(cycle.last_payment), notificationFailures: String(cycle.notice_failure_count),
  }));
  const issueRows: ReadOnlyRow[] = [
    ...report.findings.map((finding) => ({
      id: 'finding:' + finding.id, detected: isoTimestamp(finding.created_at),
      category: 'Stripe reconciliation', type: finding.kind.replaceAll('_', ' '),
      member: finding.member, link: finding.profile_id ? `/admin/members?profileId=${finding.profile_id}` : undefined,
      detail: finding.summary, status: 'Needs reconciliation',
    })),
    ...renewalConcerns.map((concern) => ({
      id: 'journey:' + concern.kind + ':' + concern.userId, detected: isoTimestamp(concern.occurredAt.toISOString()),
      category: 'Member journey', type: concern.kind.replaceAll('_', ' '),
      member: concern.member || concern.email,
      link: concern.profileId ? `/admin/members?profileId=${concern.profileId}` : undefined,
      detail: concern.note, status: 'Follow-up needed',
    })),
    ...failures.slice(0, 2000).map((cycle) => ({
      id: 'period:' + cycle.profile_id + ':' + cycle.expires_on,
      detected: isoTimestamp(cycle.expires_on), category: 'Renewal period',
      type: Number(cycle.failed_checkout_count) > 0 ? 'Checkout failed' : 'Notice send issue',
      member: cycle.member || cycle.email, link: `/admin/members?profileId=${cycle.profile_id}`,
      detail: `${cycle.failed_checkout_count} failed checkouts; ${cycle.notice_failure_count} notice errors`,
      status: 'Investigate',
    })),
  ];
  const noticeRows: ReadOnlyRow[] = report.notices.map((notice) => ({
    id: String(notice.id), queued: isoTimestamp(notice.created_at),
    member: notice.member || notice.email, link: `/admin/members?profileId=${notice.profile_id}&tab=notifications`,
    email: notice.email, kind: notice.kind.replace('membership.', '').replaceAll('_', ' '),
    sent: isoTimestamp(notice.sent_at), status: notice.status,
    providerStatus: notice.provider_status ?? 'Unverified',
    paidAfter: notice.paid_after ? 'Recorded payment afterward' : 'No recorded payment afterward',
  }));
  const cohortRows: ReadOnlyRow[] = [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, group]) => ({
    id: month, month, due: String(group.count), attempted: String(group.attempted),
    paid: String(group.paid), rate: percentage(group.paid, group.count),
  }));
  return <main className="flex-1 space-y-6 px-5 py-8 lg:px-8">
    <header><p className="eyebrow">Administration</p><h1 className="mt-2 font-display text-3xl text-gold">Membership Health</h1>
      <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground">Monitor renewal periods, notifications, checkout attempts, payments and operational concerns across members. Each signal is attributed to its recorded source; payment evidence is not itself proof of a completed entitlement change.</p>
    </header>
    <MembershipHealthFilters from={range.from} to={range.to} />
    <nav aria-label="Membership Health sections" className="flex flex-wrap gap-2 border-b pb-3">{TABS.map((item) => <Link aria-current={tab === item.id ? 'page' : undefined} className={`rounded-md border px-3 py-2 text-sm ${tab === item.id ? 'border-gold text-gold' : 'border-border text-muted-foreground hover:text-foreground'}`} href={`/admin/membership-health?tab=${item.id}`} key={item.id}>{item.label}</Link>)}</nav>
    {tab === 'overview' && <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Renewal periods due" value={int(due.length)} note="Observed historical expiration periods due by today" />
        <Metric label="Periods with payment evidence" value={int(paid.length)} note={percentage(paid.length, due.length) + ' have payment in the observation window; not a verified renewal rate'} />
        <Metric label="Periods with checkout attempts" value={int(attempted.length)} note={percentage(attempted.length, due.length) + ' have a checkout attempt'} />
        <Metric label="Current operational concerns" value={int(openCases.length)} note="Unresolved cases from automated renewal health scans" />
      </section>
      {heading('Renewal lifecycle')}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Notices queued" value={int(report.notices.length)} note="Recent 2,000 records in selected period" />
        <Metric label="Checkout sessions" value={int(report.checkoutAttempts)} note="Created in selected period" />
        <Metric label="Completed checkout sessions" value={int(report.completedCheckouts)} note="Does not independently prove entitlement" />
        <Metric label="Payments recorded" value={int(report.payments)} note="Non-legacy payments recorded in selected period" />
      </section>
      {heading('Unresolved renewal concerns')}
      {openCases.length === 0 ? <Empty>No currently open automated renewal investigation cases.</Empty> : <>
        <p className="text-sm text-muted-foreground">{openCases.length} unresolved investigation cases. Open cases remain visible regardless of the selected date range.</p>
        <Link className="idoc-secondary-button inline-block px-4 py-2 text-sm" href="/admin/membership-health?tab=issues">Investigate issues</Link>
      </>}
    </>}
    {tab === 'tracking' && <section className="space-y-3">
      {heading('Renewal Tracking')}
      <p className="text-sm text-muted-foreground">Expiration periods are reconstructed from durable renewal-period evidence. Notices and payments are correlated within an observation window around expiration; they do not establish causation. Showing up to 2,000 records; headline and cohort totals use all matching periods.</p>
      <AdminReadOnlyTable columns={[
        { id: 'member', label: 'Member' }, { id: 'email', label: 'Email' },
        { id: 'expiration', label: 'Expiration' }, { id: 'status', label: 'Status' },
        { id: 'imported', label: 'Account origin' }, { id: 'classification', label: 'Classification' },
        { id: 'notices', label: 'Notices sent / queued' }, { id: 'checkout', label: 'Checkout attempts' },
        { id: 'checkoutFailures', label: 'Checkout failures' }, { id: 'payments', label: 'Payments' },
        { id: 'lastPayment', label: 'Last payment' }, { id: 'notificationFailures', label: 'Notice errors' },
      ]} dateColumn="expiration" empty="No renewal periods match this range." filterColumns={['imported', 'classification']} initialPreferences={trackingPrefs} preferenceKey="membership_health_tracking" rows={trackingRows} searchLabel="Search renewal tracking" statusColumn="status" />
    </section>}
    {tab === 'issues' && <section className="space-y-3">
      {heading('Issues & Alerts')}
      <p className="text-sm text-muted-foreground">Stripe reconciliation findings remain visible regardless of the reporting date range. Member journey flags and checkout/notice failure signals are diagnostic, not automatic payment-failure conclusions. Use the existing authorized and audited reconciliation actions to resolve a finding.</p>
      <h3 className="text-lg font-semibold">Managed investigation cases</h3>
      <p className="text-sm text-muted-foreground">Automated scans persist case evidence. Open a case to assign an administrator, document investigation steps, and resolve or dismiss it with an audit record. All unresolved cases remain visible regardless of the selected dates.</p>
      <AdminReadOnlyTable columns={[
        { id: 'member', label: 'Investigation case' }, { id: 'severity', label: 'Severity' },
        { id: 'status', label: 'Status' }, { id: 'type', label: 'Issue type' },
        { id: 'owner', label: 'Assigned to' }, { id: 'detected', label: 'First seen' },
        { id: 'lastSeen', label: 'Last seen' },
      ]} empty="No saved investigation cases." filterColumns={['severity', 'type']} rows={caseRows} initialPreferences={casePrefs} preferenceKey="membership_health_cases" searchLabel="Search investigation cases" statusColumn="status" />
      <Link className="idoc-secondary-button inline-block px-4 py-2 text-sm" href="/admin/reconciliation">Open Stripe reconciliation</Link>
      <AdminReadOnlyTable columns={[
        { id: 'detected', label: 'Detected / associated date' }, { id: 'category', label: 'Category' },
        { id: 'type', label: 'Issue type' }, { id: 'member', label: 'Member' },
        { id: 'status', label: 'Status' }, { id: 'detail', label: 'Evidence / next action' },
      ]} dateColumn="detected" empty="No recorded renewal-related concerns." filterColumns={['category', 'type']} initialPreferences={issuePrefs} preferenceKey="membership_health_issues" rows={issueRows} searchLabel="Search membership issues" statusColumn="status" />
    </section>}
    {tab === 'notifications' && <section className="space-y-3">
      {heading('Notification Performance')}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Notices queued" value={int(report.notices.length)} note="Displayed rows are capped at 2,000" />
        <Metric label="Brevo delivered" value={int(report.notices.filter((notice) => notice.provider_status === 'delivered').length)} note="Provider webhook confirmed delivery" />
        <Metric label="Still pending" value={int(report.pendingNotices)} note="Outbox has not marked sent or dead-lettered" />
        <Metric label="Send failures" value={int(report.bouncedNotices)} note="Dead-lettered outbox records, not Brevo bounces" />
      </div>
      <p className="text-sm text-muted-foreground">Brevo status is matched by the recorded message reference. Missing status is Unverified. A payment after notice is temporal correlation only, not proof the notice caused renewal.</p>
      <Link className="idoc-secondary-button inline-block px-4 py-2 text-sm" href="/admin/communications">Open full Communications delivery investigation</Link>
      <AdminReadOnlyTable columns={[
        { id: 'queued', label: 'Queued' }, { id: 'member', label: 'Member' }, { id: 'email', label: 'Email' },
        { id: 'kind', label: 'Notice type' }, { id: 'sent', label: 'Sent' },
        { id: 'status', label: 'Outbox status' }, { id: 'providerStatus', label: 'Brevo status' },
        { id: 'paidAfter', label: 'Payment afterward' },
      ]} dateColumn="queued" empty="No notices were queued during this period." filterColumns={['kind', 'providerStatus']} initialPreferences={noticePrefs} preferenceKey="membership_health_notifications" rows={noticeRows} searchLabel="Search renewal notices" statusColumn="status" />
    </section>}
    {tab === 'cohorts' && <section className="space-y-3">
      {heading('Trends & Cohorts')}
      <p className="text-sm text-muted-foreground">Renewal periods are grouped by expiration month, using recorded historical periods. A period is due only after its expiration date; recent groups can be incomplete during the grace period. Payment evidence is not a certified conversion rate.</p>
      <AdminReadOnlyTable columns={[
        { id: 'month', label: 'Expiration month' }, { id: 'due', label: 'Periods due' },
        { id: 'attempted', label: 'Checkout attempted' }, { id: 'paid', label: 'Payment evidence' },
        { id: 'rate', label: 'Payment evidence rate' },
      ]} empty="No due renewal periods in this range." initialPreferences={cohortPrefs} preferenceKey="membership_health_cohorts" rows={cohortRows} searchLabel="Search renewal cohorts" />
      {heading('Legacy member activation and renewal')}
      <section className="grid gap-4 sm:grid-cols-3">
        <Metric label="Imported expiration periods" value={int(imported.length)} note="Durable periods in selected date range" />
        <Metric label="Imported with payment evidence" value={int(imported.filter((row) => Number(row.payment_count) > 0).length)} note="Excludes imported legacy payment history" />
        <Metric label="Imported with checkout attempts" value={int(imported.filter((row) => Number(row.checkout_count) > 0).length)} note="Not necessarily paid or renewed" />
      </section>
      <p className="text-sm text-muted-foreground">Classification is captured from the matching membership period when available; older inferred periods may be marked unknown rather than assigned a current classification. Historical visibility before renewal-period tracking is incomplete.</p>
    </section>}
    {selectedCase ? <MembershipHealthCaseDrawer key={selectedCase.id} record={selectedCase} /> : null}
    <p className="text-xs text-muted-foreground">Operational reporting is read-only. Case status, owner and resolution notes are audited administrator actions. Tables limit rendered rows; aggregate period totals use the complete set. Review the Membership Health operations runbook before interpreting or acting on apparent discrepancies.</p>
  </main>;
}
