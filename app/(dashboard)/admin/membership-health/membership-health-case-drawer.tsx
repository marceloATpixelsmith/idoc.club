import Link from 'next/link';
import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { CsrfField } from '@/components/security/csrf-field';
import type { MembershipHealthCase } from '@/lib/membership/health-cases';
import { updateMembershipHealthCase } from './actions';

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
      <form action={updateMembershipHealthCase} className="space-y-5 rounded-lg border p-5">
        <CsrfField/>
        <input type="hidden" name="id" value={record.id}/>
        <div>
          <label className="mb-2 block text-sm font-semibold" htmlFor="health-case-status">Investigation status</label>
          <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue={record.status} id="health-case-status" name="status" required>
            <option value="new">New</option><option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold" htmlFor="health-case-assignment">Assigned administrator</label>
          <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue="keep" id="health-case-assignment" name="assignment">
            <option value="keep">{record.assigned_email ? `Keep assigned: ${record.assigned_email}` : 'Leave unassigned'}</option>
            <option value="me">Assign to me</option>
            <option value="unassigned">Unassign</option>
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold" htmlFor="health-case-note">Investigation / resolution notes</label>
          <textarea className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue={record.resolution_note ?? ''} id="health-case-note" maxLength={2000} name="resolutionNote" placeholder="Document the provider evidence, action taken and outcome."/>
          <p className="mt-1 text-xs text-muted-foreground">At least 10 characters are required when resolving or dismissing a case. Changes are audited.</p>
        </div>
        <button className="idoc-primary-button px-4 py-2 text-sm" type="submit">Save investigation</button>
      </form>
    </div>
  </AdminFormDrawer>;
}
