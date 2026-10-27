import Link from 'next/link';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { getRevenueReport } from '@/lib/payments/revenue-report';
import { listAssignedOpenConversationsForDashboard, CATEGORY_LABELS, STATUS_LABELS } from '@/lib/support/inbox';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { listNewMembersLastWeek } from '@/lib/membership/new-members';
import { getCommunicationsReport } from '@/lib/notifications/communications-report-data';
import { getMemberJourneyConcerns } from '@/lib/notifications/member-journey-health';
import { requireAdministrator } from '@/lib/membership/authorization';

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en', { currency, style: 'currency' }).format(cents / 100);
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ journeyPage?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const [support, newMembers, communications, revenue, journeyConcerns] = await Promise.all([
    listAssignedOpenConversationsForDashboard(5),
    listNewMembersLastWeek(),
    getCommunicationsReport(),
    // A one-minute per-instance cache: this overview aggregates every payment on each dashboard load. The Revenue page stays live.
    getRevenueReport({}, { cacheSeconds: 60 }),
    getMemberJourneyConcerns(),
  ]);
  const delivered = communications.renewalRows.filter((row) => row.brevo === 'delivered');
  // KEEP ALL MEMBER JOURNEY CONCERNS ACCESSIBLE; NEVER HIDE ACCOUNTS BEYOND THE OVERVIEW'S FIRST PAGE.
  const { journeyPage: requestedPageParam } = await searchParams;
  const requestedPage = requestedPageParam && /^[1-9]\d{0,5}$/.test(requestedPageParam) ? Number(requestedPageParam) : 1;
  const journeyPageCount = Math.max(1, Math.ceil(journeyConcerns.length / 20));
  const journeyPage = Math.min(requestedPage, journeyPageCount);
  const journeyStart = (journeyPage - 1) * 20;

  return <main className="flex-1 space-y-6 px-5 py-8 lg:px-8">
    <header>
      <p className="eyebrow">Administration</p>
      <h1 className="mt-2 font-display text-3xl text-gold">Admin Dashboard</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Current work requiring administrator attention, last week's new members and delivered renewal notices, and a compact operational revenue summary.</p>
    </header>

    <div className="grid gap-6 xl:grid-cols-2">
      <AdminFormSection title="My unresolved support">
        {support.length === 0 ? <p className="text-sm text-muted-foreground">No unresolved support tickets are assigned to you.</p> : (
          <ul className="divide-y divide-border">
            {support.map((item) => (
              <li className="py-3 first:pt-0 last:pb-0" key={item.public_id}>
                <Link className="font-medium hover:underline" href={`/admin/support?supportId=${encodeURIComponent(item.public_id)}`}>{item.subject}</Link>
                <p className="mt-1 text-sm text-muted-foreground">{item.member_name || item.member_email} · {CATEGORY_LABELS[item.category]} · {STATUS_LABELS[item.status]}</p>
                <p className="mt-1 text-xs text-muted-foreground">{new Date(item.updated_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
        <Link className="idoc-secondary-button mt-4 px-4 py-2 text-sm" href="/admin/support">Open Support Inbox</Link>
      </AdminFormSection>

      <AdminFormSection description="Members who joined in the last 7 days." title="Newest members">
        <p className="text-2xl font-semibold">{newMembers.total} <span className="text-sm font-normal text-muted-foreground">new this week</span></p>
        {newMembers.total === 0 ? <p className="text-sm text-muted-foreground">No new members in the last 7 days.</p> : (
          <>
            {newMembers.byClassification.length > 0 ? <p className="text-sm text-muted-foreground">{newMembers.byClassification.map((row) => `${row.count} ${row.label}`).join(' · ')}</p> : null}
            <ul className="divide-y divide-border">
              {newMembers.recent.map((member) => (
                <li className="py-3 first:pt-0 last:pb-0" key={member.profileId}>
                  <Link className="font-medium hover:underline" href={`/admin/members?profileId=${member.profileId}`}>{member.name}</Link>
                  <p className="mt-1 text-sm text-muted-foreground">{member.countryCode} · joined {member.joinedAt.toISOString().slice(0, 10)}</p>
                </li>
              ))}
            </ul>
            {newMembers.total > newMembers.recent.length ? <p className="text-xs text-muted-foreground">Showing the newest {newMembers.recent.length} of {newMembers.total}.</p> : null}
          </>
        )}
        <Link className="idoc-secondary-button mt-4 px-4 py-2 text-sm" href="/admin/members">Open Members</Link>
      </AdminFormSection>
    </div>

    <div id="member-journey-health" className="scroll-mt-24">
    <AdminFormSection description="Potential member access and renewal problems found in durable account, queue, session, and membership records. These are follow-up signals, not proof of failure. Updated whenever this dashboard loads." title="Member journey health">
      <p className="text-2xl font-semibold">{journeyConcerns.length} <span className="text-sm font-normal text-muted-foreground">member journey concerns</span></p>
      {journeyConcerns.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No monitored activation, login, onboarding, or renewal concerns meet the escalation thresholds.</p> : (
        <ul className="mt-4 divide-y divide-border">
          {journeyConcerns.slice(journeyStart, journeyStart + 20).map((issue) => (
            <li className="py-3 first:pt-0 last:pb-0" key={`${issue.kind}-${issue.userId}`}>
              {issue.profileId ? <Link className="font-medium hover:underline" href={`/admin/members?profileId=${issue.profileId}`}>{issue.member === '—' ? issue.email : issue.member}</Link> : <span className="font-medium">{issue.member === '—' ? issue.email : issue.member}</span>}
              <p className="mt-1 text-sm text-muted-foreground">{issue.email} · {issue.note}{issue.count > 1 ? ` (${issue.count} attempts / items)` : ''}</p>
              <p className="mt-1 text-xs text-muted-foreground">Last evidence: {issue.occurredAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
            </li>
          ))}
        </ul>
      )}
      {journeyConcerns.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">Showing {journeyStart + 1}–{Math.min(journeyStart + 20, journeyConcerns.length)} of {journeyConcerns.length} concerns · Page {journeyPage} of {journeyPageCount}</p>
          {journeyPageCount > 1 ? (
            <nav aria-label="Member journey concerns pages" className="flex gap-2">
              {journeyPage > 1 ? <Link className="idoc-secondary-button px-4 py-2 text-sm" href={`/admin?journeyPage=${journeyPage - 1}#member-journey-health`}>Previous</Link> : null}
              {journeyPage < journeyPageCount ? <Link className="idoc-secondary-button px-4 py-2 text-sm" href={`/admin?journeyPage=${journeyPage + 1}#member-journey-health`}>Next</Link> : null}
            </nav>
          ) : null}
        </div>
      ) : null}
      <Link className="idoc-secondary-button mt-4 px-4 py-2 text-sm" href="/admin/communications">Open Communications</Link>
    </AdminFormSection>
    </div>

    <AdminFormSection description="Renewal notices from the last 7 days that Brevo's log shows as delivered. Delivery does not confirm the member received or acted on them." title="Delivered renewal notices">
      {communications.brevoAvailable ? null : <p className="text-sm text-muted-foreground">Brevo&apos;s log could not be read, so delivery cannot be confirmed right now.</p>}
      <p className="text-2xl font-semibold">{delivered.length} <span className="text-sm font-normal text-muted-foreground">delivered</span></p>
      {delivered.length === 0 ? <p className="text-sm text-muted-foreground">No delivered renewal notices in the last 7 days.</p> : (
        <ul className="divide-y divide-border">
          {delivered.map((row, index) => (
            <li className="py-3 first:pt-0 last:pb-0" key={`${row.kind}-${row.email}-${index}`}>
              <p className="font-medium">{row.member} <span className="font-normal text-muted-foreground">· {row.label}</span></p>
              <p className="mt-1 text-sm text-muted-foreground">{row.email ?? '—'} · {row.sentAt ? row.sentAt.toISOString().slice(0, 10) : ''}</p>
            </li>
          ))}
        </ul>
      )}
      <Link className="idoc-secondary-button mt-4 px-4 py-2 text-sm" href="/admin/communications">Open Communications</Link>
    </AdminFormSection>

    <AdminFormSection description={`Recorded successful membership payments from ${revenue.range.from} through ${revenue.range.to}.`} title="Revenue overview">
      {revenue.summary.length === 0 ? <p className="text-sm text-muted-foreground">No recorded revenue in this period.</p> : (
        <div className="space-y-5">
          {revenue.summary.map((row) => (
            <section key={row.currency}>
              <h3 className="mb-3 text-sm font-semibold">{row.currency}</h3>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <article className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Gross revenue</p><p className="mt-1 text-2xl font-semibold">{money(row.totalCents, row.currency)}</p></article>
                <article className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Stripe</p><p className="mt-1 text-2xl font-semibold">{money(row.stripeCents, row.currency)}</p></article>
                <article className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Manual</p><p className="mt-1 text-2xl font-semibold">{money(row.manualCents, row.currency)}</p></article>
                <article className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Payments</p><p className="mt-1 text-2xl font-semibold">{row.paymentCount}</p></article>
              </div>
            </section>
          ))}
        </div>
      )}
      <Link className="idoc-secondary-button mt-1 px-4 py-2 text-sm" href="/admin/revenue">View revenue report</Link>
    </AdminFormSection>
  </main>;
}
