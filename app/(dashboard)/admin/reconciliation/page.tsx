import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { count, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { auditLog, reconciliationIgnores } from '@/lib/db/schema';
import { getLastReconciliationRun, listReconciliationFindings, requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireAdministrator, requireSuperAdmin } from '@/lib/membership/authorization';
import { ignoreFindings, isIgnorableFinding, restoreIgnoredIssue } from '@/lib/payments/reconciliation-remediation';
import { rehearsalReadStatus } from '@/lib/payments/rehearsal-read-client';
import { RECONCILIATION_KIND_LABELS } from '@/lib/payments/reconciliation-report';
import { stripeIdForFinding, summarizeFindings } from '@/lib/payments/reconciliation-guide';
import { runReconciliationScan } from '@/lib/payments/reconciliation-scan';
import { requireCsrfToken } from '@/lib/security/csrf';
import { ReconciliationTabs } from './reconciliation-tabs';
import type { IgnoreState } from './ignore-findings';
import { ReconciliationFindingsTable } from './reconciliation-findings-table';
import { ResolutionPanel, type ResolutionSummary } from './resolution-panel';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { RunScanForm, type RunScanState } from './run-scan-form';

const PATH = '/admin/reconciliation';

const KIND_LABELS = RECONCILIATION_KIND_LABELS;

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

async function ignoreSelected(_state: IgnoreState, formData: FormData): Promise<IgnoreState> {
  'use server';
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireAdministrator(actor);
    const ids = formData.getAll('findingId').flatMap((value) => (typeof value === 'string' && /^\d+$/.test(value) ? [Number(value)] : []));
    if (ids.length === 0) return { error: 'No issues were selected.' };
    const ignored = await ignoreFindings(actor.id, ids);
    revalidatePath(PATH);
    return { success: `Ignored ${ignored.toLocaleString('en-GB')} issue(s). They will no longer appear in the report.` };
  } catch (error) {
    if (error instanceof AuthorizationError || (error instanceof Error && error.name === 'CsrfError')) return { error: error.message };
    return { error: 'The issues could not be ignored.' };
  }
}

async function restoreIgnored(formData: FormData): Promise<void> {
  'use server';
  await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const id = Number(formData.get('ignoreId'));
  if (Number.isInteger(id) && id > 0) await restoreIgnoredIssue(actor.id, id);
  revalidatePath(PATH);
}

const IGNORED_PAGE_SIZE = 100;

export default async function AdminReconciliationPage({ searchParams }: { searchParams?: Promise<{ ignoredPage?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const requestedPage = Number((await searchParams)?.ignoredPage);
  const ignoredPage = Number.isInteger(requestedPage) && requestedPage > 1 ? requestedPage : 1;
  const [lastRun, findings, ignored, [{ total: ignoredTotal }]] = await Promise.all([getLastReconciliationRun(), listReconciliationFindings(),
    db.select().from(reconciliationIgnores).orderBy(desc(reconciliationIgnores.ignoredAt), desc(reconciliationIgnores.id)).limit(IGNORED_PAGE_SIZE).offset((ignoredPage - 1) * IGNORED_PAGE_SIZE),
    db.select({ total: count() }).from(reconciliationIgnores)]);
  const ignoredPages = Math.max(1, Math.ceil(ignoredTotal / IGNORED_PAGE_SIZE));
  // What the last scan resolved by itself before reporting (the summary is written in the same transaction as the run row).
  const [resolution] = lastRun ? await db.select({ afterJson: auditLog.afterJson, createdAt: auditLog.createdAt }).from(auditLog)
    .where(eq(auditLog.action, 'reconciliation.scan_resolution_summary')).orderBy(desc(auditLog.createdAt)).limit(1) : [];
  const resolutionSummary = resolution && lastRun && Math.abs(resolution.createdAt.getTime() - lastRun.ranAt.getTime()) < 120_000 ? resolution.afterJson as ResolutionSummary : null;
  let isSuperAdmin = true;
  try { requireSuperAdmin(actor); } catch { isSuperAdmin = false; }
  let rehearsal = false;
  try { rehearsal = rehearsalReadStatus().active; } catch { rehearsal = false; }

  return <main className="flex-1 py-8 px-5 lg:px-8">
    <h1 className="text-3xl font-semibold text-gold">Stripe Reconciliation</h1>
    <p className="mt-2 text-sm text-foreground">
      A daily comparison of membership billing and seminar registration payment state against Stripe. The scan resolves everything with a known answer itself before it reports, so the findings below are only what needs a person. For membership findings, use the existing member tools
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
          {resolutionSummary ? <ResolutionPanel summary={resolutionSummary} /> : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No reconciliation run has completed yet.</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">The scan runs automatically every day at 07:00 UTC. The findings below are from the last run, so anything changed since (an import, a fix) shows up after the next one.</p>
      {isSuperAdmin ? <RunScanForm action={runScanNow} /> : null}
    </section>

    {rehearsal ? (
      <p className="mt-4 max-w-3xl rounded-lg border border-amber-400/50 bg-amber-950/20 p-4 text-sm text-amber-200" role="note">
        Rehearsal mode is on in this environment: the scan compares your real, live Stripe account with the data in this environment. Live customers and subscriptions that have not been imported here show up as findings until the import is done. Changes to this environment's own database are made as they would be in production; changes to Stripe (cancelling orphaned subscriptions, deleting unlinked customers) are only simulated: they are listed as done and leave the findings, but nothing is changed in Stripe. Seminar checks are skipped in this mode. Items from the sandbox test members appear as "not found in Stripe".
      </p>
    ) : null}

    <section className="mt-8">
      <ReconciliationTabs
        findingsTable={
          <ReconciliationFindingsTable
            ignoreAction={ignoreSelected}
            rows={findings.map((finding) => ({
              id: String(finding.id), category: ['seminar_payment_conflict', 'refund_conflict', 'missing_refund', 'dispute', 'chargeback'].includes(finding.kind) ? 'Seminar' : 'Membership', kind: KIND_LABELS[finding.kind] ?? finding.kind,
              summary: finding.summary, stripeId: stripeIdForFinding(finding), member: finding.profileId ? 'View member' : '—',
              link: finding.profileId ? `/admin/members?profileId=${finding.profileId}` : undefined,
              detected: finding.createdAt.toISOString(), ignorable: isIgnorableFinding(finding) ? 'yes' : 'no',
            }))}
          />
        }
        scanState={!lastRun ? 'never' : lastRun.status === 'completed' ? 'ok' : 'failed'}
        summary={summarizeFindings(findings)}
        total={findings.length}
      />
    </section>

    {ignoredTotal > 0 ? (
      <section className="mt-8 max-w-3xl rounded-lg border p-4">
        <details>
          <summary className="cursor-pointer font-medium text-foreground">Ignored issues ({ignoredTotal.toLocaleString('en-GB')})</summary>
          <p className="mt-2 text-xs text-muted-foreground">These are left out of the report and out of the scan's automatic actions. An ignored issue is forgotten once it no longer exists, so a later recurrence is reported afresh. Restore one to see it again on the next scan.</p>
          <ul className="mt-2 space-y-2">
            {ignored.map((item) => (
              <li className="flex flex-wrap items-center gap-2 text-sm" key={item.id}>
                <span className="font-medium text-foreground">{KIND_LABELS[item.kind] ?? item.kind}</span>
                <span className="font-mono text-xs text-muted-foreground">{item.subjectKey}</span>
                <span className="text-xs text-muted-foreground">ignored {formatUtc(item.ignoredAt)}</span>
                <form action={restoreIgnored} className="ml-auto">
                  <CsrfField />
                  <input name="ignoreId" type="hidden" value={item.id} />
                  <Button size="sm" type="submit" variant="outline">Restore</Button>
                </form>
              </li>
            ))}
          </ul>
          {ignoredPages > 1 ? (
            <nav aria-label="Ignored issues pages" className="mt-3 flex items-center gap-3 text-sm">
              {ignoredPage > 1 ? <Link className="text-primary underline underline-offset-4" href={`${PATH}?ignoredPage=${ignoredPage - 1}`}>Previous</Link> : null}
              <span className="text-muted-foreground">Page {ignoredPage} of {ignoredPages}</span>
              {ignoredPage < ignoredPages ? <Link className="text-primary underline underline-offset-4" href={`${PATH}?ignoredPage=${ignoredPage + 1}`}>Next</Link> : null}
            </nav>
          ) : null}
        </details>
      </section>
    ) : null}
  </main>;
}
