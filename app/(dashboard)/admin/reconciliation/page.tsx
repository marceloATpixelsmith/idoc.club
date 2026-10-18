import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { AdminReadOnlyTable } from '@/components/admin/admin-read-only-table';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { db } from '@/lib/db/drizzle';
import { auditLog } from '@/lib/db/schema';
import { getLastReconciliationRun, listReconciliationFindings, requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireAdministrator, requireSuperAdmin } from '@/lib/membership/authorization';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { deleteUnlinkedCustomers } from '@/lib/payments/reconciliation-remediation';
import { remediationAllowed } from '@/lib/payments/remediation-gate';
import { rehearsalReadStatus } from '@/lib/payments/rehearsal-read-client';
import { stripeIdForFinding, summarizeFindings } from '@/lib/payments/reconciliation-guide';
import { runReconciliationScan } from '@/lib/payments/reconciliation-scan';
import { requireCsrfToken } from '@/lib/security/csrf';
import { ReconciliationTabs } from './reconciliation-tabs';
import { CleanupCustomersForm, type CleanupCustomersState } from './cleanup-customers-form';
import { DeleteSelectedCustomers } from './delete-selected-customers';
import { RunScanForm, type RunScanState } from './run-scan-form';

const PATH = '/admin/reconciliation';
// Deleting a few hundred customers makes several Stripe calls each.
export const maxDuration = 300;

const KIND_LABELS: Record<string, string> = {
  orphaned_subscription: 'Orphaned active Stripe subscription',
  repeated_failure: 'Repeated payment failures',
  status_conflict: 'Subscription status conflict',
  unlinked_customer: 'Unlinked Stripe Customer',
  pending_schedule_conflict: 'Pending renewal schedule conflict',
  seminar_payment_conflict: 'Seminar payment conflict',
  refund_conflict: 'Refund conflict',
  missing_refund: 'Missing refund',
  dispute: 'Payment dispute',
  chargeback: 'Chargeback',
};

function formatUtc(date: Date) {
  const iso = date.toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)} UTC`;
}

async function runScanNow(_state: RunScanState, formData: FormData): Promise<RunScanState> {
  'use server';
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireSuperAdmin(actor);
    await db.insert(auditLog).values({ actorId: actor.id, action: 'admin.reconciliation.scan_requested', entityType: 'reconciliation', entityId: 'manual' });
    const { findingsCount } = await runReconciliationScan();
    revalidatePath('/admin/reconciliation');
    return { success: `The scan finished and found ${findingsCount.toLocaleString('en-GB')} item(s).` };
  } catch (error) {
    if (error instanceof AuthorizationError || (error instanceof Error && error.name === 'CsrfError')) return { error: error.message };
    revalidatePath('/admin/reconciliation');
    return { error: 'The scan could not be completed. The Last run box above shows the error that was recorded.' };
  }
}

async function cleanupCustomers(_state: CleanupCustomersState, formData: FormData): Promise<CleanupCustomersState> {
  'use server';
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireSuperAdmin(actor);
    const stepUp = await requireFreshStepUp(actor, 'change-security-settings', PATH);
    if (stepUp.required) return { stepUpRequired: true };
    const selectedIds = formData.getAll('customerId').filter((value): value is string => typeof value === 'string' && /^cus_[A-Za-z0-9]+$/.test(value));
    if (formData.has('customerId') && selectedIds.length === 0) return { error: 'No valid Stripe customers were selected.' };
    const result = await deleteUnlinkedCustomers(actor.id, undefined, undefined, false, formData.has('customerId') ? selectedIds : undefined);
    revalidatePath(PATH);
    const skipped = result.skipped.length ? ` ${result.skipped.length.toLocaleString('en-GB')} skipped for safety.` : '';
    const failed = result.failed.length ? ` ${result.failed.length.toLocaleString('en-GB')} could not be deleted; run it again.` : '';
    return { csv: result.csv, success: `Deleted ${result.deleted.length.toLocaleString('en-GB')} customer(s) in Stripe.${skipped}${failed}` };
  } catch (error) {
    if (error instanceof AuthorizationError || (error instanceof Error && error.name === 'CsrfError')) return { error: error.message };
    return { error: error instanceof Error && error.message.startsWith('Deleting Stripe customers') ? error.message : 'The cleanup could not be completed safely. Nothing further was deleted.' };
  }
}

export default async function AdminReconciliationPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const [lastRun, findings] = await Promise.all([getLastReconciliationRun(), listReconciliationFindings()]);
  let isSuperAdmin = true;
  try { requireSuperAdmin(actor); } catch { isSuperAdmin = false; }
  let cleanupAvailable = false;
  try { cleanupAvailable = isSuperAdmin && remediationAllowed(); } catch { cleanupAvailable = false; }
  const unlinkedCount = findings.filter((finding) => finding.kind === 'unlinked_customer').length;
  let rehearsal = false;
  try { rehearsal = rehearsalReadStatus().active; } catch { rehearsal = false; }

  return <main className="flex-1 py-8 px-5 lg:px-8">
    <h1 className="text-3xl font-semibold text-gold">Stripe Reconciliation</h1>
    <p className="mt-2 text-sm text-foreground">
      A read-only daily comparison of membership billing and seminar registration payment state against live Stripe data. For membership findings, use the existing member tools
      (suspend/reinstate, correct entitlement) from the <Link className="text-primary underline underline-offset-4 hover:opacity-80" href="/admin/members">Members page</Link>. Review seminar payment findings in <Link className="text-primary underline underline-offset-4 hover:opacity-80" href="/admin/seminars/registrations">Seminar Registrations</Link>.
    </p>

    <section className="mt-6 max-w-2xl border rounded-lg p-4">
      <h2 className="font-medium text-foreground">Last run</h2>
      {lastRun ? (
        <>
          <p className="mt-2 text-sm text-foreground">Ran at: {formatUtc(lastRun.ranAt)}</p>
          <p className="mt-1 text-sm text-foreground">Status: {lastRun.status === 'completed' ? 'Completed' : 'Failed'}</p>
          {lastRun.status === 'failed' && <p className="mt-1 text-sm text-red-400">Error: {lastRun.errorMessage}</p>}
          <p className="mt-1 text-sm text-foreground">Findings on that run: {lastRun.findingsCount}</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No reconciliation run has completed yet.</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">The scan runs automatically every day at 07:00 UTC. The findings below are from the last run, so anything changed since (an import, a fix) shows up after the next one.</p>
      {isSuperAdmin ? <RunScanForm action={runScanNow} /> : null}
    </section>

    {rehearsal ? (
      <p className="mt-4 max-w-3xl rounded-lg border border-amber-400/50 bg-amber-950/20 p-4 text-sm text-amber-200" role="note">
        Rehearsal mode is on in this environment: the scan compares your real, live Stripe account with the data in this environment. Live customers and subscriptions that have not been imported here show up as findings, so a long list before the legacy import is expected, and it shrinks once the import is done and the scan runs again. Items from the sandbox test members appear as "not found in Stripe". Seminar checks are skipped in this mode.
      </p>
    ) : null}

    {cleanupAvailable && unlinkedCount > 0 ? (
      <section className="mt-6 max-w-2xl rounded-lg border p-4">
        <h2 className="font-medium text-foreground">Clean up unlinked Stripe customers</h2>
        <p className="mt-2 text-sm text-foreground">IDOC is the record of members, so a Stripe customer it has no record of is safe to remove. Customers with a live subscription, an open invoice or a recent charge are skipped, and each deletion is logged.</p>
        <CleanupCustomersForm action={cleanupCustomers} count={unlinkedCount} />
      </section>
    ) : null}

    {!cleanupAvailable && unlinkedCount > 0 ? (
      <p className="mt-6 max-w-2xl rounded-lg border p-4 text-sm text-muted-foreground" role="note">
        {isSuperAdmin
          ? 'Unlinked Stripe customers can be deleted from this page only in the live production deployment once billing has been released. Here the list is for information.'
          : 'Only a Super Admin can delete unlinked Stripe customers, and only in the live production deployment.'}
      </p>
    ) : null}

    <section className="mt-8">
      <ReconciliationTabs
        findingsTable={
          <AdminReadOnlyTable
            bulkActions={cleanupAvailable ? ({ clearSelection, selected }) => <DeleteSelectedCustomers action={cleanupCustomers} clearSelection={clearSelection} selected={selected} /> : undefined}
            columns={[{ id: 'category', label: 'Category' }, { id: 'kind', label: 'Type' }, { id: 'summary', label: 'Summary' }, { id: 'stripeId', label: 'Stripe ID' }, { id: 'member', label: 'Member' }, { id: 'detected', label: 'Detected' }]}
            dateColumn="detected"
            empty="No findings from the last run."
            filterColumns={['kind']}
            rows={findings.map((finding) => ({
              id: String(finding.id), category: ['seminar_payment_conflict', 'refund_conflict', 'missing_refund', 'dispute', 'chargeback'].includes(finding.kind) ? 'Seminar' : 'Membership', kind: KIND_LABELS[finding.kind] ?? finding.kind,
              summary: finding.summary, stripeId: stripeIdForFinding(finding), member: finding.profileId ? 'View member' : '—',
              link: finding.profileId ? `/admin/members?profileId=${finding.profileId}` : undefined,
              detected: finding.createdAt.toISOString(),
            }))}
            searchLabel="Search reconciliation findings"
            statusColumn="category"
            tableType="reconciliation"
          />
        }
        scanState={!lastRun ? 'never' : lastRun.status === 'completed' ? 'ok' : 'failed'}
        summary={summarizeFindings(findings)}
        total={findings.length}
      />
    </section>
  </main>;
}
