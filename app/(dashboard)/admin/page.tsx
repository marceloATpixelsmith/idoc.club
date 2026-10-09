import Link from 'next/link';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { getRevenueReport } from '@/lib/payments/revenue-report';
import { listAssignedOpenConversationsForDashboard, CATEGORY_LABELS, STATUS_LABELS } from '@/lib/support/inbox';
import { listReconciliationFindings, requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

const RECONCILIATION_KIND_LABELS: Record<string, string> = {
  orphaned_subscription: 'Orphaned active Stripe subscription',
  repeated_failure: 'Repeated payment failures',
  status_conflict: 'Subscription status conflict',
  unlinked_customer: 'Unlinked Stripe Customer',
  pending_schedule_conflict: 'Pending renewal schedule conflict',
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en', { currency, style: 'currency' }).format(cents / 100);
}

export default async function AdminPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const [support, reconciliation, revenue] = await Promise.all([
    listAssignedOpenConversationsForDashboard(5),
    listReconciliationFindings(),
    getRevenueReport(),
  ]);
  const latestReconciliation = [...reconciliation].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 5);

  return <main className="flex-1 space-y-6 px-5 py-8 lg:px-8">
    <header>
      <p className="eyebrow">Administration</p>
      <h1 className="mt-2 font-display text-3xl text-gold">Admin Dashboard</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Current work requiring administrator attention and a compact operational revenue summary.</p>
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

      <AdminFormSection title="Stripe reconciliation">
        {latestReconciliation.length === 0 ? <p className="text-sm text-muted-foreground">No unresolved reconciliation findings.</p> : (
          <ul className="divide-y divide-border">
            {latestReconciliation.map((finding) => (
              <li className="py-3 first:pt-0 last:pb-0" key={finding.id}>
                <p className="font-medium">{RECONCILIATION_KIND_LABELS[finding.kind] ?? finding.kind}</p>
                <p className="mt-1 text-sm text-muted-foreground">{finding.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">{finding.createdAt.toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
        <Link className="idoc-secondary-button mt-4 px-4 py-2 text-sm" href="/admin/reconciliation">Open reconciliation</Link>
      </AdminFormSection>
    </div>

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
