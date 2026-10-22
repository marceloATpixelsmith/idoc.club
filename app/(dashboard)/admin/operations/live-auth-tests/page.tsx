import { notFound } from 'next/navigation';
import { TestTube2 } from 'lucide-react';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { listManualGithubOperationRuns } from '@/lib/admin/manual-github-operations';
import matrix from '@/tests/auth/auth-test-matrix.json';
import { ManualGithubOperationForm } from '../github-operations/manual-github-operation-form';
import { runOperationAction } from '../github-operations/actions';
import { LiveAuthRunHistory } from './live-auth-run-history';

export default async function LiveAuthTestsPage() {
  const actor = await requireAccountAccess('administration');
  try { requireSuperAdmin(actor); } catch (error) { if (error instanceof AuthorizationError) notFound(); throw error; }

  let runs: Awaited<ReturnType<typeof listManualGithubOperationRuns>> = [];
  let error: string | null = null;
  try { runs = (await listManualGithubOperationRuns()).filter(run => run.workflow === 'live-auth'); }
  catch { error = 'Could not load GitHub live authentication runs.'; }

  const cases = matrix.cases.map(item => ({ id: item.id, title: item.title, steps: item.live.steps, passCriteria: item.live.pass }));
  return <main className="space-y-6 px-5 py-8 lg:px-8">
    <header className="space-y-2">
      <p className="eyebrow">Super Admin Operations</p>
      <h1 className="text-3xl font-semibold text-gold">Live Authentication Tests</h1>
      <p className="max-w-3xl text-muted-foreground">Run the real staging authentication journey, examine each saved test report, and distinguish passed cases from failures, blocked cases and tests not yet automated.</p>
    </header>
    <section className="space-y-3 rounded-lg border border-border bg-surface/40 p-5">
      <div className="flex items-center gap-2"><TestTube2 className="size-5 text-gold"/><h2 className="text-lg font-semibold">Start Live Authentication Test</h2></div>
      <p className="text-sm text-muted-foreground">Uses the currently deployed staging commit. Creates and cleans up a disposable account and mailbox; uploads results and browser evidence to GitHub Actions.</p>
      <ManualGithubOperationForm action={runOperationAction} workflow="live-auth" label="Run Live Authentication Tests" />
    </section>
    <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
      <h2 className="text-lg font-semibold">Recent Live Authentication Tests</h2>
      <p className="text-sm text-muted-foreground">Select View Results to open the JSON report in a drawer. A green workflow confirms the implemented browser run—not that every cataloged case was executed.</p>
      {error ? <p role="alert" className="text-red-300">{error}</p> : null}
      <LiveAuthRunHistory cases={cases} runs={runs} />
    </section>
  </main>;
}
