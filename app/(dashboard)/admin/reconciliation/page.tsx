import Link from 'next/link';
import { getLastReconciliationRun, listReconciliationFindings, requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

const KIND_LABELS: Record<string, string> = {
  orphaned_subscription: 'Orphaned active Stripe subscription',
  repeated_failure: 'Repeated payment failures',
  status_conflict: 'Subscription status conflict',
  unlinked_customer: 'Unlinked Stripe Customer',
};

export default async function AdminReconciliationPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const [lastRun, findings] = await Promise.all([getLastReconciliationRun(), listReconciliationFindings()]);

  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">Stripe reconciliation</h1>
    <p className="mt-2 text-sm text-foreground">
      A read-only daily comparison of local subscription/billing state against live Stripe data. Act on findings using the existing member tools
      (suspend/reinstate, correct entitlement) from the <Link className="text-primary underline underline-offset-4 hover:opacity-80" href="/admin/members">Members page</Link>.
    </p>

    <section className="mt-6 max-w-2xl border rounded-lg p-4">
      <h2 className="font-medium text-foreground">Last run</h2>
      {lastRun ? (
        <>
          <p className="mt-2 text-sm text-foreground">Ran at: {lastRun.ranAt.toISOString()}</p>
          <p className="mt-1 text-sm text-foreground">Status: {lastRun.status === 'completed' ? 'Completed' : 'Failed'}</p>
          {lastRun.status === 'failed' && <p className="mt-1 text-sm text-red-400">Error: {lastRun.errorMessage}</p>}
          <p className="mt-1 text-sm text-foreground">Findings on that run: {lastRun.findingsCount}</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No reconciliation run has completed yet.</p>
      )}
    </section>

    <section className="mt-8 overflow-x-auto">
      <h2 className="font-medium text-foreground">Current findings</h2>
      <table className="mt-2 min-w-full border text-sm">
        <thead>
          <tr className="border-b bg-surface text-left">
            <th className="p-2">Kind</th>
            <th className="p-2">Summary</th>
            <th className="p-2">Member</th>
            <th className="p-2">Detected</th>
          </tr>
        </thead>
        <tbody>
          {findings.length === 0 && (
            <tr><td className="p-2 text-muted-foreground" colSpan={4}>No findings from the last run.</td></tr>
          )}
          {findings.map((finding) => (
            <tr key={finding.id} className="border-b align-top">
              <td className="p-2">{KIND_LABELS[finding.kind] ?? finding.kind}</td>
              <td className="p-2">{finding.summary}</td>
              <td className="p-2">
                {finding.profileId
                  ? <Link className="text-primary underline underline-offset-4 hover:opacity-80" href={`/admin/members?profileId=${finding.profileId}`}>View member</Link>
                  : '—'}
              </td>
              <td className="p-2">{finding.createdAt.toISOString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  </main>;
}
