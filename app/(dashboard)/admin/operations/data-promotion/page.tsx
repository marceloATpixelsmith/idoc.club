import { notFound } from 'next/navigation';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';

import { PromotionExecuteForm, type PromotionActionState } from './promotion-execute-form';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { requireCsrfToken } from '@/lib/security/csrf';
import {
  buildPromotionPlan,
  DataPromotionError,
  executePromotionPlan,
  listPromotionCandidates,
  listPromotionHistory,
  parsePromotionDataset,
  type PromotionDataset,
} from '@/lib/admin/data-promotion';
import { Button } from '@/components/ui/button';

async function executePromotionAction(_state: PromotionActionState, formData: FormData): Promise<PromotionActionState> {
  'use server';

  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireSuperAdmin(actor);
    const stepUp = await requireFreshStepUp(actor, 'change-security-settings', '/admin/operations/data-promotion');
    if (stepUp.required) return { stepUpRequired: true };

    const planToken = formData.get('planToken');
    if (typeof planToken !== 'string' || !planToken) return { error: 'Generate a fresh promotion preview first.' };
    const result = await executePromotionPlan(planToken, actor.id);
    revalidatePath('/admin/operations/data-promotion');
    return { success: result.duplicate ? 'This promotion was already completed safely.' : 'Data promotion completed.' };
  } catch (error) {
    if (error instanceof DataPromotionError || error instanceof AuthorizationError ||
      (error instanceof Error && error.name === 'CsrfError')) return { error: error.message };
    return { error: 'The promotion could not be completed safely.' };
  }
}

function selectedRecords(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function datasetLabel(dataset: PromotionDataset) {
  if (dataset === 'news') return 'News / Blog';
  if (dataset === 'seminar') return 'Seminars';
  return 'Organization Settings';
}

export default async function DataPromotionPage({
  searchParams,
}: {
  searchParams: Promise<{ dataset?: string; record?: string | string[]; search?: string; page?: string }>;
}) {
  const actor = await requireAccountAccess('administration');
  try {
    requireSuperAdmin(actor);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  const params = await searchParams;
  const dataset = parsePromotionDataset(params.dataset) ?? 'news';
  const records = selectedRecords(params.record);
  const search = typeof params.search === 'string' ? params.search.slice(0, 100) : '';
  const page = typeof params.page === 'string' && /^[1-9][0-9]{0,3}$/.test(params.page) ? Number(params.page) : 1;

  let candidates: Awaited<ReturnType<typeof listPromotionCandidates>> = [];
  let history: Awaited<ReturnType<typeof listPromotionHistory>> = [];
  let preview: Awaited<ReturnType<typeof buildPromotionPlan>> | null = null;
  let configurationError: string | null = null;
  let previewError: string | null = null;

  try {
    [candidates, history] = await Promise.all([listPromotionCandidates(dataset, search, page), listPromotionHistory()]);
  } catch (error) {
    configurationError = error instanceof Error ? error.message : 'Data promotion is not configured.';
  }

  if (!configurationError && records.length) {
    try {
      preview = await buildPromotionPlan(dataset, records);
    } catch (error) {
      previewError = error instanceof Error ? error.message : 'The promotion preview could not be generated.';
    }
  }

  const hasNextPage = candidates.length > 100;
  const visibleCandidates = candidates.slice(0, 100);
  const pageUrl = (number: number) => '/admin/operations/data-promotion?' + new URLSearchParams({
    dataset, search, page: String(number),
  }).toString();

  const tabs: Array<{ dataset: PromotionDataset; label: string }> = [
    { dataset: 'news', label: 'News / Blog' },
    { dataset: 'seminar', label: 'Seminars' },
    { dataset: 'organization', label: 'Organization Settings' },
  ];

  return (
    <main className="space-y-8 px-5 py-8 lg:px-8">
      <header className="space-y-2">
        <p className="eyebrow">Super Admin Operations</p>
        <h1 className="text-3xl font-semibold text-gold">Data Promotion</h1>
        <p className="max-w-3xl text-muted-foreground">
          Preview and selectively promote approved staging content to Production. Member, billing, registration,
          authentication, audit-history, and other operational datasets are not promotable here.
        </p>
      </header>

      {configurationError ? (
        <section className="rounded-lg border border-red-400/40 bg-red-950/20 p-4 text-sm text-red-200" role="alert">
          {configurationError}
        </section>
      ) : (
        <>
          <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">1. Select Staging Records</h2>
              <p className="text-sm text-muted-foreground">Up to 10 records may be promoted atomically in one operation.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <Button asChild key={tab.dataset} variant={dataset === tab.dataset ? 'default' : 'secondary'}>
                  <Link href={'/admin/operations/data-promotion?dataset=' + tab.dataset}>{tab.label}</Link>
                </Button>
              ))}
            </div>
            <form className="flex flex-wrap items-end gap-3" method="get">
              <input name="dataset" type="hidden" value={dataset} />
              <label className="flex min-w-64 flex-1 flex-col gap-2 text-sm font-medium text-foreground">
                Search staging records by title or ID
                <input aria-label="Search staging records" className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="search" defaultValue={search} maxLength={100} placeholder="Search all staging records" />
              </label>
              <Button type="submit" variant="secondary">Search records</Button>
            </form>
            <form className="space-y-4" method="get">
              <input name="dataset" type="hidden" value={dataset} />
              <input name="search" type="hidden" value={search} />
              <input name="page" type="hidden" value={page} />
              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">{datasetLabel(dataset)}</span>
                <select
                  className="min-h-48 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  defaultValue={records}
                  multiple={dataset !== 'organization'}
                  name="record"
                  size={Math.min(Math.max(visibleCandidates.length, 2), 10)}
                >
                  {visibleCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.label} — {candidate.meta}</option>
                  ))}
                </select>
              </label>
              {dataset !== 'organization' ? (
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Page {page} · Up to 100 results per page. Search by title or staging ID.</span>
                  {page > 1 ? <Link className="underline" href={pageUrl(page - 1)}>Previous page</Link> : null}
                  {hasNextPage ? <Link className="underline" href={pageUrl(page + 1)}>Next page</Link> : null}
                </div>
              ) : null}
              <Button type="submit">Generate Preview</Button>
            </form>
          </section>

          <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">2. Preview and Validate</h2>
              <p className="text-sm text-muted-foreground">
                The preview is read-only, signed, and expires after five minutes. Execution rechecks both schemas before commit.
              </p>
            </div>
            {previewError ? <p className="text-sm text-red-300" role="alert">{previewError}</p> : null}
            {!preview && !previewError ? <p className="text-sm text-muted-foreground">Select records above to generate a promotion plan.</p> : null}
            {preview ? (
              <div className="space-y-5">
                <p className="text-xs text-muted-foreground">Operation {preview.operationId} · expires {new Date(preview.expiresAt).toLocaleString()}</p>
                {preview.items.map((item) => (
                  <article className="space-y-3 rounded-md border border-border p-4" key={item.sourceId}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground">{item.label}</h3>
                        <p className="text-xs text-muted-foreground">Staging ID {item.sourceId} · {item.promotionKey}</p>
                      </div>
                      <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase">{item.action}</span>
                    </div>
                    {item.reason ? <p className="text-sm text-red-300">{item.reason}</p> : null}
                    {item.warnings.map((warning) => <p className="text-sm text-amber-200" key={warning}>{warning}</p>)}
                    {item.changes.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead><tr className="border-b border-border"><th className="py-2 pr-3">Field</th><th className="py-2 pr-3">Production</th><th className="py-2">Staging</th></tr></thead>
                          <tbody>
                            {item.changes.map((change) => (
                              <tr className="border-b border-border/60 align-top" key={change.field}>
                                <td className="py-2 pr-3 font-medium">{change.field}</td>
                                <td className="max-w-sm break-words py-2 pr-3 text-muted-foreground">{change.from}</td>
                                <td className="max-w-sm break-words py-2">{change.to}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-sm text-muted-foreground">No Production changes are required.</p>}
                  </article>
                ))}
                {preview.planToken ? (
                  <div className="space-y-2 border-t border-border pt-4">
                    <p className="text-sm text-muted-foreground">
                      Execution requires current Super Admin authority and a fresh authenticator verification.
                    </p>
                    <PromotionExecuteForm action={executePromotionAction} planToken={preview.planToken} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Promotion History</h2>
              <p className="text-sm text-muted-foreground">Successful operations are recorded without private record dumps or credentials.</p>
            </div>
            {history.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-border"><th className="py-2 pr-3">Time</th><th className="py-2 pr-3">Dataset</th><th className="py-2 pr-3">Result</th><th className="py-2">Operation</th></tr></thead>
                  <tbody>
                    {history.map((item) => (
                      <tr className="border-b border-border/60" key={item.operationId}>
                        <td className="py-2 pr-3">{new Date(item.createdAt).toLocaleString()}</td>
                        <td className="py-2 pr-3">{item.dataset}</td>
                        <td className="py-2 pr-3">{item.summary}</td>
                        <td className="py-2 font-mono text-xs">{item.operationId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-muted-foreground">No successful promotions have been recorded yet.</p>}
          </section>
        </>
      )}
    </main>
  );
}
