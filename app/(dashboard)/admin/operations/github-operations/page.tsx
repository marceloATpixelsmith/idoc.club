import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ExternalLink, GitBranch, TestTube2 } from 'lucide-react';
import { and, eq, gt, sql } from 'drizzle-orm';

import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { requireCsrfToken } from '@/lib/security/csrf';
import { db } from '@/lib/db/drizzle';
import { auditLog } from '@/lib/db/schema';
import {
  dispatchManualGithubOperation,
  isManualGithubWorkflow,
  listManualGithubOperationRuns,
  MANUAL_GITHUB_WORKFLOWS,
  ManualGithubOperationsError,
  type ManualGithubWorkflow,
} from '@/lib/admin/manual-github-operations';
import { ManualGithubOperationForm, type ManualGithubOperationActionState } from './manual-github-operation-form';
import { PromotionStatusRefresh } from './promotion-status-refresh';

const PATH = '/admin/operations/github-operations';

async function authorize(formData: FormData) {
  await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  return actor;
}

async function reserveRequest(actorId: number, workflow: ManualGithubWorkflow): Promise<boolean> {
  const action = 'admin.github_operation.requested';
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`idoc-manual-github-${workflow}`}))`);
    const [recent] = await tx.select({ id: auditLog.id }).from(auditLog)
      .where(and(
        eq(auditLog.action, action),
        eq(auditLog.entityId, workflow),
        gt(auditLog.createdAt, sql`now() - interval '2 minutes'`),
      )).limit(1);
    if (recent) return false;
    await tx.insert(auditLog).values({
      actorId,
      action,
      entityType: 'github_workflow',
      entityId: workflow,
      afterJson: { ref: 'staging', workflowFile: MANUAL_GITHUB_WORKFLOWS[workflow].file },
    });
    return true;
  });
}

async function runOperationAction(
  _state: ManualGithubOperationActionState,
  formData: FormData,
): Promise<ManualGithubOperationActionState> {
  'use server';
  try {
    const actor = await authorize(formData);
    const value = formData.get('workflow');
    if (!isManualGithubWorkflow(value)) return { error: 'Choose one of the available GitHub operations.' };
    const stepUp = await requireFreshStepUp(actor, 'change-security-settings', PATH);
    if (stepUp.required) return { stepUpRequired: true };

    const active = (await listManualGithubOperationRuns()).some((run) =>
      run.workflow === value && (run.status === 'queued' || run.status === 'in_progress'));
    if (active) return { error: 'This GitHub workflow is already queued or running. Refresh the page after it finishes.' };
    if (!(await reserveRequest(actor.id, value))) {
      return { error: 'This operation was requested in the last two minutes. Refresh the page before trying again.' };
    }

    const promotionUrl = await dispatchManualGithubOperation(value);
    revalidatePath(PATH);
    return {
      success: value === 'production-promotion' ? 'Promotion monitoring requested. The GitHub workflow will verify CI/reviews, merge and check Vercel deployment and production health. Follow its status below.' : 'The operation was dispatched to the staging branch.',
      workflowUrl: promotionUrl ?? MANUAL_GITHUB_WORKFLOWS[value].url,
    };
  } catch (error) {
    if (error instanceof ManualGithubOperationsError || error instanceof AuthorizationError ||
      (error instanceof Error && error.name === 'CsrfError')) return { error: error.message };
    return { error: 'The GitHub operation could not be started safely.' };
  }
}

function runStatusLabel(status: string) {
  if (status === 'queued') return 'QUEUED';
  if (status === 'in_progress') return 'RUNNING';
  if (status === 'success') return 'PASSED';
  if (status === 'failure') return 'FAILED';
  if (status === 'cancelled') return 'CANCELLED';
  return 'FINISHED';
}

function runStatusClass(status: string) {
  if (status === 'success') return 'text-emerald-300';
  if (status === 'failure' || status === 'cancelled') return 'text-red-300';
  if (status === 'queued' || status === 'in_progress') return 'text-amber-200';
  return 'text-muted-foreground';
}

export default async function ManualGithubOperationsPage() {
  const actor = await requireAccountAccess('administration');
  try {
    requireSuperAdmin(actor);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  let runs: Awaited<ReturnType<typeof listManualGithubOperationRuns>> = [];
  let runsError: string | null = null;
  try {
    runs = await listManualGithubOperationRuns();
  } catch (error) {
    runsError = error instanceof ManualGithubOperationsError ? error.message : 'GitHub could not be reached. Try again shortly.';
  }

  return (
    <main className="space-y-8 px-5 py-8 lg:px-8">
      <header className="space-y-2">
        <p className="eyebrow">Super Admin Operations</p>
        <h1 className="text-3xl font-semibold text-gold">Manual GitHub Operations</h1>
        <p className="max-w-3xl text-muted-foreground">
          Start live authentication tests or initiate a monitored staging-to-production promotion. The protected promotion workflow checks CI, reviews, merge, Vercel deployment and production health; failures stop the process and remain visible below. Fresh authenticator verification is required and every request is audited.
        </p>
      </header>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
          <div className="flex items-start gap-3">
            <GitBranch aria-hidden="true" className="mt-1 size-5 shrink-0 text-gold" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">Promote Staging to Production</h2>
              <p className="text-sm text-muted-foreground">
                Initiates a monitored promotion of all code on <code>staging</code> to <code>main</code>. Required PR checks and reviews must pass before merging. The workflow then verifies Vercel production deployment and the production health endpoint. Start only after completing staging acceptance checks.
              </p>
            </div>
          </div>
          <ManualGithubOperationForm action={runOperationAction} workflow="production-promotion" label="Start Monitored Promotion" />
        </article>

        <article className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
          <div className="flex items-start gap-3">
            <TestTube2 aria-hidden="true" className="mt-1 size-5 shrink-0 text-gold" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">Run Live Authentication Tests</h2>
              <p className="text-sm text-muted-foreground">
                Waits for the current staging deployment, then runs the sequential live-auth journey with one disposable mailbox and test account. The run cleans them up and uploads its result matrix and browser evidence to GitHub Actions.
              </p>
            </div>
          </div>
          <ManualGithubOperationForm action={runOperationAction} workflow="live-auth" label="Run Live Authentication Tests" />
        </article>
      </section>

      <PromotionStatusRefresh active={runs.some((run) => run.workflow === 'production-promotion' && (run.status === 'queued' || run.status === 'in_progress'))} />

      {runsError ? <section className="rounded-lg border border-red-400/40 bg-red-950/20 p-4 text-sm text-red-200" role="alert">{runsError}</section> : null}

      <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Recent GitHub Operations</h2>
            <p className="text-sm text-muted-foreground">View the actual status of each operation, individual promotion stages, failures and GitHub logs.</p>
          </div>
          <a className="inline-flex items-center gap-2 text-sm text-gold underline" href="https://github.com/marceloATpixelsmith/idoc.club/actions" rel="noreferrer" target="_blank">
            All GitHub Actions <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </div>
        {runs.length ? (
          <ul className="space-y-2">
            {runs.map((run) => (
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border p-3 text-sm" key={run.id}>
                <span className={runStatusClass(run.status)}>{runStatusLabel(run.status)}</span>
                <span>{MANUAL_GITHUB_WORKFLOWS[run.workflow].label}</span>
                <span className="text-muted-foreground">#{run.runNumber} · {run.event === 'workflow_dispatch' ? 'Manually started' : 'Automatic'} · {new Date(run.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</span>
                <a className="inline-flex items-center gap-1 text-gold underline" href={run.runUrl} rel="noreferrer" target="_blank">View run <ExternalLink aria-hidden="true" className="size-3" /></a>
                {run.workflow === 'production-promotion' ? (
                  <ul className="w-full space-y-1 border-t border-border pt-2 text-sm">
                    {(run.steps ?? []).map((step) => (
                      <li className="flex flex-wrap items-center justify-between gap-2" key={step.name}>
                        <span>{step.name}</span>
                        <span className={runStatusClass(step.conclusion === 'success' ? 'success' : step.conclusion === 'failure' ? 'failure' : step.status)}>
                          {step.conclusion === 'success' ? 'PASSED' : step.conclusion === 'failure' ? 'FAILED' : step.status === 'in_progress' ? 'RUNNING' : step.status === 'completed' ? 'FINISHED' : 'WAITING'}
                        </span>
                      </li>
                    ))}
                    {run.status === 'failure' ? <li className="text-red-300">This promotion was not verified successful. Open its GitHub run to see the exact failing step.</li> : null}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No operation runs are available yet. Initiated promotions appear here after GitHub accepts their workflow dispatch.</p>
        )}
      </section>
    </main>
  );
}
