import Link from 'next/link';
import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import type { MembershipHealthCase } from '@/lib/membership/health-cases';
import { MembershipHealthCaseForm } from './membership-health-case-form';

export function MembershipHealthCaseDrawer({ record }: { record: MembershipHealthCase }) {
  return <AdminFormDrawer closeHref="/admin/membership-health?tab=issues" title="Renewal investigation" wide>
    <div className="space-y-6 px-5 py-6 lg:px-8">
      <section className="rounded-lg border p-5">
        <p className="text-sm text-muted-foreground">Case #{record.id} · {record.severity.toUpperCase()} · {record.kind.replaceAll('_', ' ')}</p>
        <h2 className="mt-2 text-lg font-semibold">{record.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">First detected: {new Date(record.first_seen_at).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</p>
        <p className="text-sm text-muted-foreground">Last detected: {new Date(record.last_seen_at).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</p>
        {record.profile_id ? <Link className="mt-4 inline-block underline" href={`/admin/members?profileId=${record.profile_id}`}>Open member history</Link> : null}
        <details className="mt-4 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">Recorded evidence</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(record.evidence, null, 2)}</pre>
        </details>
      </section>
      <MembershipHealthCaseForm record={record} />
    </div>
  </AdminFormDrawer>;
}
