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
      <p className="max-w-3xl text-muted-foreground">Run the current real-staging authentication smoke test and inspect its evidence. This is not yet a complete authentication acceptance suite: most catalog cases still require automated coverage before authentication can be marked fully verified.</p>
    </header>
    <section className="space-y-3 rounded-lg border border-border bg-surface/40 p-5">
      <div className="flex items-center gap-2"><TestTube2 className="size-5 text-gold"/><h2 className="text-lg font-semibold">Start Authentication Smoke Test</h2></div>
      <p className="text-sm text-muted-foreground">Exercises real signup, email verification, login, logout and selected access checks on the deployed staging revision. It does not validate all 38 catalog cases. Creates and cleans up a disposable account and mailbox; saves evidence in GitHub Actions.</p>
      <ManualGithubOperationForm action={runOperationAction} workflow="live-auth" label="Run Authentication Smoke Test" />
    </section>
    <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
      <h2 className="text-lg font-semibold">Recent Authentication Smoke Tests</h2>
      <p className="text-sm text-muted-foreground">Select View Results to open the JSON report in a drawer. Only a complete pass of all applicable cases establishes full authentication verification. A green GitHub workflow alone confirms only the limited smoke test succeeded.</p>
      {error ? <p role="alert" className="text-red-300">{error}</p> : null}
      <LiveAuthRunHistory cases={cases} runs={runs} />
    </section>
  </main>;
}
