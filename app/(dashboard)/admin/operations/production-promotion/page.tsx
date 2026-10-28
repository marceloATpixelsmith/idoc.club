import { notFound } from 'next/navigation';
import { GitBranch, ExternalLink } from 'lucide-react';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { listManualGithubOperationRuns } from '@/lib/admin/manual-github-operations';
import { ManualGithubOperationForm } from '../github-operations/manual-github-operation-form';
import { runOperationAction } from '../github-operations/actions';
import { PromotionStatusRefresh } from '../github-operations/promotion-status-refresh';

export default async function ProductionPromotionPage() {
  const actor = await requireAccountAccess('administration');
  try { requireSuperAdmin(actor); } catch (error) { if (error instanceof AuthorizationError) notFound(); throw error; }
  let runs: Awaited<ReturnType<typeof listManualGithubOperationRuns>> = [];
  let error: string | null = null;
  try { runs = (await listManualGithubOperationRuns()).filter(run => (run.workflow === 'production-promotion' || run.workflow === 'production-recovery')); }
  catch { error = 'Could not load GitHub promotion runs.'; }

  return <main className="space-y-6 px-5 py-8 lg:px-8">
    <header className="space-y-2">
      <p className="eyebrow">Super Admin Operations</p>
      <h1 className="text-3xl font-semibold text-gold">Promote Staging To Production</h1>
      <p className="max-w-3xl text-muted-foreground">Runs the protected staging-to-main promotion. If the code was already merged into main without completing the release, starts the protected backup-first production migration and rebuild recovery instead of creating an empty PR. Both paths require GitHub environment approval.</p>
    </header>
    <section className="space-y-3 rounded-lg border border-border bg-surface/40 p-5">
      <div className="flex items-center gap-2"><GitBranch className="size-5 text-gold"/><h2 className="text-lg font-semibold">Start Promotion</h2></div>
      <ManualGithubOperationForm action={runOperationAction} workflow="production-promotion" label="Start Monitored Promotion" />
    </section>
    <PromotionStatusRefresh active={runs.some(run => run.status === 'queued' || run.status === 'in_progress')} />
    <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
      <h2 className="text-lg font-semibold">Recent Production Promotions</h2>
      {error ? <p role="alert" className="text-red-300">{error}</p> : null}
      <ul className="space-y-3">
        {runs.map(run => <li className="space-y-3 rounded-lg border border-border p-3" key={run.id}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <strong className={run.status === 'success' ? 'text-emerald-300' : run.status === 'failure' ? 'text-red-300' : 'text-amber-200'}>{run.status.toUpperCase()}</strong>
            <span>Run #{run.runNumber} · {new Date(run.startedAt).toLocaleString()}</span>
            <a className="inline-flex items-center gap-1 text-gold underline" href={run.runUrl} target="_blank" rel="noreferrer">GitHub Details <ExternalLink className="size-3"/></a>
          </div>
          <ul className="space-y-2 border-t border-border pt-2">{(run.steps ?? []).map(step => <li className="flex justify-between gap-2 text-sm" key={step.name}><span>{step.name}</span><span className={step.conclusion === 'success' ? 'text-emerald-300' : step.conclusion === 'failure' ? 'text-red-300' : 'text-muted-foreground'}>{step.conclusion?.toUpperCase() ?? step.status.toUpperCase()}</span></li>)}</ul>
        </li>)}
      </ul>
      {!runs.length && !error ? <p className="text-muted-foreground">No recent promotion runs found.</p> : null}
    </section>
  </main>;
}
